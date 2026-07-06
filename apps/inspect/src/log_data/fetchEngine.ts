import { LogHandle } from "@tsmono/inspect-common";
import { throttle } from "@tsmono/util";

import {
  ClientAPI,
  LogDetails,
  LogHeader,
  LogPreview,
} from "../client/api/types";
import { DatabaseService, LogFetchStateRecord } from "../client/database";
import { toLogPreview } from "../client/utils/type-utils";
import { WorkPriority, WorkQueue, WorkResult } from "../utils/workQueue";

/**
 * The one place backend log-list data (details, previews) is fetched.
 *
 * Owns the priority work queues, the local database (engine-private: sole
 * reader; writes go through the sink so the db ⟹ cache invariant holds), and
 * per-item completion promises. Producers (replication discovery, polling)
 * enqueue work; consumers await `fetch()` promises or read the react-query
 * collections the sink feeds. Priority is an argument, not an architecture.
 *
 * Framework-free by design: `api`, `database`, and the cache sink are injected
 * at the composition root; the engine never imports react-query or zustand.
 * Mode-independent: alive in dir mode (with the replication producer) and
 * single-file mode (no producer) alike.
 */

/**
 * Urgency of a fetch: `user` = someone is looking at it, front-runs
 * everything; `elevated` = freshness matters soon (a running log's poll
 * tick, newly changed files); `background` = backfill.
 */
export type FetchPriority = "background" | "elevated" | "user";

const toWorkPriority = (priority: FetchPriority): WorkPriority => {
  switch (priority) {
    case "user":
      return WorkPriority.User;
    case "elevated":
      return WorkPriority.High;
    case "background":
      return WorkPriority.Medium;
  }
};

// The kind of a queued fetch — the single queue's batch group. Batches never
// mix kinds, so a worker call only ever sees one.
type LogWorkKind = "preview" | "details";

interface LogWork {
  kind: LogWorkKind;
  handle: LogHandle;
}

const workId = (kind: LogWorkKind, name: string) => `${kind}:${name}`;

const previewWork = (handle: LogHandle): LogWork => ({
  kind: "preview",
  handle,
});
const detailsWork = (handle: LogHandle): LogWork => ({
  kind: "details",
  handle,
});

// The queue's TOutput. Tagging a successful value with its own kind lets
// onComplete narrow it (via a plain `=== "preview"` check) without a type
// assertion — the queue itself is kind-agnostic.
type LogWorkValue =
  | { kind: "preview"; value: LogPreview }
  | { kind: "details"; value: LogDetails };

/**
 * The cache write surface the engine writes results through — the
 * `logsContent` seam bound to a log dir (and its database) at the composition
 * root. `write*`/`clear*` persist to the database and mirror into the cache;
 * `set*`/`merge*` are cache-only (for seeding data that is already persisted).
 * Note the asymmetry: `writeDetails` takes transport payloads (the sink
 * normalizes them into entity stores); `mergeDetails` takes the stored
 * header form (its inputs come back OUT of the store).
 */
export interface LogsContentSink {
  setHandles(handles: LogHandle[]): void;
  mergePreviews(previews: Record<string, LogPreview>): void;
  mergeDetails(headers: Record<string, LogHeader>): void;
  writeHandles(handles: LogHandle[]): Promise<LogHandle[]>;
  writePreviews(previews: Record<string, LogPreview>): Promise<void>;
  writeDetails(details: Record<string, LogDetails>): Promise<void>;
  mergeFetchStates(states: Record<string, LogFetchStateRecord>): void;
  writeFetchStates(states: Record<string, LogFetchStateRecord>): Promise<void>;
  clearFile(name: string): Promise<void>;
  clearPreview(name: string): Promise<void>;
  clearAll(): Promise<void>;
}

export interface FetchEngineDeps {
  api: ClientAPI;
  /** Engine-private persistence; null when unavailable (e.g. single-file
   *  sessions), in which case every read misses and writes are cache-only. */
  database: DatabaseService | null;
  sink: LogsContentSink;
}

export interface DbStats {
  logCount: number;
  previewCount: number;
  detailsCount: number;
}

export interface FetchEngineStatus {
  syncing: boolean;
  dbStats: DbStats;
}

/**
 * A replication discovery result. `listing` is the server's listing (a delta
 * or the full list — `persistListing` upserts it into the database and
 * re-reads the full list; otherwise it's activated cache-only, for static
 * listings that carry no mtimes to sync by). `invalidated` names files whose
 * cached content is stale (new/changed); `deleted` names files that no longer
 * exist.
 */
export interface ListingUpdate {
  listing: LogHandle[];
  invalidated: string[];
  deleted: string[];
  persistListing: boolean;
}

/** Queue/batching tunables — production defaults; tests shrink them. */
export interface FetchEngineOptions {
  /** Single global concurrency cap shared by previews and details (≈ a
   *  browser per-host connection pool). */
  concurrency?: number;
  previewBatchSize?: number;
  flushDelayMs?: number;
  statsDelayMs?: number;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const kInitialStats: DbStats = {
  logCount: 0,
  previewCount: 0,
  detailsCount: 0,
};

// How many preview tasks to fetch at High priority before the long tail drops
// to Medium — keeps the first screenful fresh without starving detail work.
const kPreviewFirstWave = 25;

// A file whose fetch has settled-failed this many times is presumed
// permanently broken (not transient) — backfill gives up on it until an
// invalidation (a changed file) wipes its fetch-state row.
const kMaxFetchAttempts = 5;

const emptyFetchState = (name: string): LogFetchStateRecord => ({
  file_path: name,
  preview_attempts: 0,
  details_attempts: 0,
  details_settled_seq: 0,
  updated_at: new Date().toISOString(),
});

export class FetchEngine {
  private _deps: FetchEngineDeps | undefined = undefined;

  // The current listing, mirroring what the sink last activated. The engine's
  // own copy so key resolution and diffing need no cache/db round-trip.
  private _handles: LogHandle[] = [];

  private readonly _queue: WorkQueue<LogWork, LogWorkValue>;
  private _processingCount = 0;

  // Completion promises for `fetch()` callers, keyed by resolved log name.
  // An entry exists from enqueue until resolve/reject, so concurrent callers
  // share one fetch (in-flight dedupe). Settle-only (void): no caller reads
  // the payload, and the cache-hit path couldn't produce one without
  // re-reading every summary row.
  private readonly _pendingFetches = new Map<string, Deferred<void>>();
  // Names currently claimed by a worker (no longer in the queue) — a
  // duplicate `fetch()` must not re-enqueue these.
  private readonly _inFlightDetails = new Set<string>();
  // Names whose next fetch must bypass any server-side cache (cached=false).
  private readonly _freshDetails = new Set<string>();
  // Names with an ACTIVE (non-passive) fetch() outstanding — a passive call
  // (ensure-presence, e.g. a sample-adjacent mount) never adds itself here,
  // so its settle must not bump `details_settled_seq`. A later active call
  // joining the same in-flight fetch adds the key too, upgrading it.
  private readonly _activeSettles = new Set<string>();
  // Engine generation, bumped on every stop() — a batch claimed under an
  // earlier generation that settles after a stop()/start() (dir switch) is
  // discarded rather than recorded/waited-on/coalesced into the new
  // session's state.
  private _epoch = 0;
  // The generation active when a work item's batch was claimed, keyed by
  // `workId` (kind-scoped — a preview and a details item can share a name).
  private readonly _claimEpoch = new Map<string, number>();

  // Engine-private mirror of the fetch-state table, hydrated at start() and
  // kept in sync as completions settle — the source of truth for backfill
  // gating (avoids a db round-trip per batch). Writes still go through the
  // sink so the db ⟹ cache invariant holds.
  private _fetchStates: Record<string, LogFetchStateRecord> = {};

  // Batched sink writes for background completions (user-awaited completions
  // write immediately).
  private _pendingPreviewWrites: Record<string, LogPreview> = {};
  private _pendingDetailWrites: Record<string, LogDetails> = {};
  private _flushingPreviews = false;
  private _flushingDetails = false;
  private readonly _throttledFlushPreviewWrites: () => void;
  private readonly _throttledFlushDetailWrites: () => void;
  private readonly _throttledUpdateDbStats: () => void;

  private _status: FetchEngineStatus = {
    syncing: false,
    dbStats: kInitialStats,
  };
  private readonly _statusListeners = new Set<() => void>();

  constructor(options: FetchEngineOptions = {}) {
    this._throttledUpdateDbStats = throttle(
      () => void this.updateDbStats(),
      options.statsDelayMs ?? 1000
    );
    this._throttledFlushPreviewWrites = throttle(
      () => void this.flushPreviewWrites(),
      options.flushDelayMs ?? 250
    );
    this._throttledFlushDetailWrites = throttle(
      () => void this.flushDetailWrites(),
      options.flushDelayMs ?? 250
    );

    // Single queue: previews and details share one concurrency cap (a
    // browser has one connection pool, not one per kind), but never batch
    // together (`batchGroup`) — a 24-file preview batch and a singleton
    // detail fetch have nothing in common.
    this._queue = new WorkQueue<LogWork, LogWorkValue>({
      name: "Log-Fetch-Queue",
      concurrency: options.concurrency ?? 6,
      batchGroup: (work) => work.kind,
      batchSizeFor: (work) =>
        work.kind === "preview" ? (options.previewBatchSize ?? 24) : 1,
      processingDelay: 10,
      onProcessingChanged: this.processingChanged,
      getId: (work) => workId(work.kind, work.handle.name),
      worker: (items) => {
        const head = items[0];
        if (!head) {
          return Promise.resolve([]);
        }
        return head.kind === "preview"
          ? this.previewWorker(items.map((item) => item.handle))
          : this.detailsWorker(items.map((item) => item.handle));
      },
      onComplete: (results, inputs) => {
        const head = inputs[0];
        if (head?.kind === "preview") {
          this.onPreviewComplete(results, inputs);
        } else if (head?.kind === "details") {
          this.onDetailsComplete(results, inputs);
        }
        return Promise.resolve();
      },
    });
  }

  /** Record the generation active right now against every item in a
   *  just-claimed batch — called as the first statement of each kind's
   *  worker, i.e. synchronously, before any await, so it reflects the
   *  generation at claim time. */
  private markClaimEpoch(kind: LogWorkKind, handles: LogHandle[]): void {
    const epoch = this._epoch;
    handles.forEach((log) =>
      this._claimEpoch.set(workId(kind, log.name), epoch)
    );
  }

  /** Partition a settled batch into items claimed under the CURRENT
   *  generation ("fresh") vs. an earlier one whose stop()/start() has since
   *  passed ("stale") — stale items are dropped by every onComplete handler:
   *  no fetch-state recording, no waiter interaction, no preview coalesce. */
  private dropStaleEpoch(
    results: WorkResult<LogWorkValue>[],
    inputs: LogWork[]
  ): { results: WorkResult<LogWorkValue>[]; inputs: LogWork[] } {
    const freshResults: WorkResult<LogWorkValue>[] = [];
    const freshInputs: LogWork[] = [];
    inputs.forEach((work, i) => {
      const id = workId(work.kind, work.handle.name);
      const claimEpoch = this._claimEpoch.get(id);
      this._claimEpoch.delete(id);
      const result = results[i];
      if (!result || claimEpoch !== this._epoch) {
        return;
      }
      freshResults.push(result);
      freshInputs.push(work);
    });
    return { results: freshResults, inputs: freshInputs };
  }

  private async previewWorker(
    handles: LogHandle[]
  ): Promise<WorkResult<LogWorkValue>[]> {
    this.markClaimEpoch("preview", handles);
    const deps = this._deps;
    if (!deps) {
      const error = new Error("Fetch engine stopped");
      return handles.map(() => ({ ok: false, error }));
    }
    const results = await deps.api.get_log_summaries_settled(
      handles.map((log) => log.name)
    );
    return results.map((result) =>
      result.ok
        ? { ok: true, value: { kind: "preview", value: result.value } }
        : result
    );
  }

  private onPreviewComplete(
    rawResults: WorkResult<LogWorkValue>[],
    rawInputs: LogWork[]
  ): void {
    const { results, inputs } = this.dropStaleEpoch(rawResults, rawInputs);
    if (inputs.length === 0) {
      return;
    }
    inputs.forEach((work, i) => {
      const result = results[i];
      if (!result) {
        return;
      }
      if (!result.ok) {
        console.error(
          `Preview fetch failed for ${work.handle.name}:`,
          result.error
        );
        return;
      }
      if (result.value.kind !== "preview") {
        return;
      }
      this._pendingPreviewWrites[work.handle.name] = result.value.value;
    });
    this._throttledFlushPreviewWrites();
    this.recordFetchOutcomes("preview", results, inputs);
  }

  /**
   * Record retrieval (fetch) outcomes into the fetch-state store — a domain
   * separate from eval status/error (those live in LogPreview/LogDetails). A
   * settled failure upserts the kind's error/attempts; a settled success
   * clears them, but only when a row already carries them (no write churn
   * for the common case of a log that has never failed). Updates the
   * engine-private mirror in place and writes the batch through the sink
   * (persists to db; the cache mirror push is separately guarded there).
   */
  private recordFetchOutcomes(
    kind: LogWorkKind,
    results: WorkResult<LogWorkValue>[],
    inputs: LogWork[]
  ): void {
    const deps = this._deps;
    if (!deps) {
      return;
    }
    const now = new Date().toISOString();
    const updates: Record<string, LogFetchStateRecord> = {};
    inputs.forEach((work, i) => {
      const result = results[i];
      if (!result) {
        return;
      }
      const name = work.handle.name;
      const row = this._fetchStates[name];
      if (!result.ok) {
        const next: LogFetchStateRecord = {
          ...(row ?? emptyFetchState(name)),
          updated_at: now,
          ...(kind === "preview"
            ? {
                preview_fetch_error: result.error.message,
                preview_attempts: (row?.preview_attempts ?? 0) + 1,
              }
            : {
                details_fetch_error: result.error.message,
                details_attempts: (row?.details_attempts ?? 0) + 1,
              }),
        };
        this._fetchStates[name] = next;
        updates[name] = next;
        return;
      }
      if (!row) {
        return;
      }
      const hadOwnError =
        kind === "preview"
          ? row.preview_fetch_error !== undefined || row.preview_attempts > 0
          : row.details_fetch_error !== undefined || row.details_attempts > 0;
      // A details success also lands a derived preview (the cross-kind
      // coalesce persists it — see onDetailsComplete), so it must clear a
      // stale PREVIEW fetch-state too; otherwise a file whose preview once
      // hit the gating cap keeps thrashing findMissingPreviews forever even
      // after details recovered.
      const hadStalePreview =
        kind === "details" &&
        (row.preview_fetch_error !== undefined || row.preview_attempts > 0);
      if (!hadOwnError && !hadStalePreview) {
        return;
      }
      const next: LogFetchStateRecord = {
        ...row,
        updated_at: now,
        ...(kind === "preview"
          ? { preview_fetch_error: undefined, preview_attempts: 0 }
          : { details_fetch_error: undefined, details_attempts: 0 }),
        ...(hadStalePreview
          ? { preview_fetch_error: undefined, preview_attempts: 0 }
          : {}),
      };
      this._fetchStates[name] = next;
      updates[name] = next;
    });
    if (Object.keys(updates).length > 0) {
      void deps.sink.writeFetchStates(updates).catch(() => {});
    }
  }

  private async detailsWorker(
    handles: LogHandle[]
  ): Promise<WorkResult<LogWorkValue>[]> {
    this.markClaimEpoch("details", handles);
    handles.forEach((log) => this._inFlightDetails.add(log.name));
    try {
      return await Promise.all(
        handles.map(async (log): Promise<WorkResult<LogWorkValue>> => {
          const deps = this._deps;
          if (!deps) {
            return { ok: false, error: new Error("Fetch engine stopped") };
          }
          const fresh = this._freshDetails.delete(log.name);
          try {
            const details = await deps.api.get_log_details(
              log.name,
              fresh ? false : undefined
            );
            return { ok: true, value: { kind: "details", value: details } };
          } catch (error) {
            if (fresh) {
              // Re-arm for the retry. Consume-at-read + re-add-on-failure
              // (never clear on settle) because the flag is keyed by name:
              // a mid-flight invalidation can set it for a NEWER re-enqueued
              // fetch while this attempt is in flight, and a settle-time
              // delete would consume that newer intent, letting the re-fetch
              // serve the memoized stale snapshot. A final failure
              // deliberately leaves the flag set — the next fetch of this
              // log over-fetches fresh once, erring safe.
              this._freshDetails.add(log.name);
            }
            return {
              ok: false,
              error: error instanceof Error ? error : new Error(String(error)),
            };
          }
        })
      );
    } finally {
      // Scoped to the worker call (not to "settled"), so a retried item is
      // correctly no longer "in flight" once it's back in the queue.
      handles.forEach((log) => this._inFlightDetails.delete(log.name));
    }
  }

  private onDetailsComplete(
    rawResults: WorkResult<LogWorkValue>[],
    rawInputs: LogWork[]
  ): void {
    const deps = this._deps;
    const { results, inputs } = this.dropStaleEpoch(rawResults, rawInputs);
    if (inputs.length === 0) {
      return;
    }
    this.recordFetchOutcomes("details", results, inputs);
    inputs.forEach((work, i) => {
      const name = work.handle.name;
      const result = results[i];
      if (!result) {
        return;
      }
      const waiter = this._pendingFetches.get(name);
      if (!result.ok) {
        if (waiter) {
          this._pendingFetches.delete(name);
          this._activeSettles.delete(name);
          waiter.reject(result.error);
        }
        return;
      }
      if (result.value.kind !== "details") {
        return;
      }
      const detail = result.value.value;
      // Cross-kind coalesce: these details already repaint the preview via
      // toLogPreview below, so a queued preview fetch for the same log is
      // now redundant. Persist the derived preview (not just cache it) on
      // EVERY ok settle — waitered or background — so a coalesced-away
      // preview fetch still lands a real, db-backed preview row instead of
      // leaving the file to thrash findMissingPreviews.
      this._queue.removeByIds([workId("preview", name)]);
      this._pendingPreviewWrites[name] = toLogPreview(detail);
      this._throttledFlushPreviewWrites();
      if (waiter) {
        this._pendingFetches.delete(name);
        if (deps) {
          // Someone is waiting on this, so land it now rather than in the
          // next batched flush; repaint the listing preview from the fresh
          // status (a log cached as "started" may have since finished) —
          // immediate cache-only repaint, ahead of the throttled persist above.
          this.ensureListed(name);
          void deps.sink.writeDetails({ [name]: detail }).catch(() => {});
          deps.sink.mergePreviews({ [name]: toLogPreview(detail) });
          // A waitered settle bumps the session-local "landed" counter, but
          // only for ACTIVE demand (someone genuinely wants this log open) —
          // a passive ensure-presence fetch (sample-adjacent mount) must not
          // refire LogLoadController just because it happened to settle here.
          if (this._activeSettles.delete(name)) {
            this.bumpDetailsSettledSeq(name, deps);
          }
        }
        waiter.resolve();
      } else {
        this._pendingDetailWrites[name] = detail;
        this._throttledFlushDetailWrites();
      }
    });
  }

  private bumpDetailsSettledSeq(name: string, deps: FetchEngineDeps): void {
    const base = this._fetchStates[name] ?? emptyFetchState(name);
    const bumped: LogFetchStateRecord = {
      ...base,
      details_settled_seq: base.details_settled_seq + 1,
    };
    this._fetchStates[name] = bumped;
    // Cache-only push first — the immediate signal for the guarded
    // per-handle query. Persisting it too closes the loss window where an
    // in-flight `useLogFetchState` queryFn (a full `readFetchStates` scan)
    // settles AFTER this push and overwrites the seq back to null for a
    // recreated/late-mounted per-handle entry (staleTime: Infinity — it
    // would never self-correct).
    deps.sink.mergeFetchStates({ [name]: bumped });
    void deps.sink.writeFetchStates({ [name]: bumped }).catch(() => {});
  }

  /**
   * Inject dependencies and hydrate the cache from the database (a cache-only
   * seed of already-persisted rows — the read side of the read-through cache).
   * Restartable: a prior session's state is discarded first.
   */
  public async start(deps: FetchEngineDeps): Promise<void> {
    this.stop();
    this._deps = deps;
    if (!deps.database) {
      return;
    }
    const handles = await deps.database.readLogs();
    if (!handles) {
      return;
    }
    deps.sink.setHandles(handles);
    this._handles = handles;

    const previews = await deps.database.readLogPreviews(handles);
    if (Object.keys(previews).length > 0) {
      deps.sink.mergePreviews(previews);
    }
    const details = await deps.database.readLogDetails(handles);
    if (Object.keys(details).length > 0) {
      deps.sink.mergeDetails(details);
    }

    // A restart retries every previously-failed file once more — zero the
    // attempts (but keep the error text visible until it's superseded) and
    // persist the reset so a changed-attempts row isn't left stale in db.
    const fetchStates = await deps.database.readFetchStates();
    const reset: Record<string, LogFetchStateRecord> = {};
    const now = new Date().toISOString();
    for (const [name, row] of Object.entries(fetchStates)) {
      reset[name] = {
        ...row,
        preview_attempts: 0,
        details_attempts: 0,
        updated_at: now,
      };
    }
    this._fetchStates = reset;
    if (Object.keys(reset).length > 0) {
      await deps.sink.writeFetchStates(reset);
    }

    await this.updateDbStats();
  }

  /** Drop dependencies, queued work, and pending waiters (rejected). Bumps
   *  the epoch so any batch already claimed (in flight, no longer in the
   *  queue) settles into the void instead of the next session's state. */
  public stop(): void {
    this._epoch += 1;
    this._deps = undefined;
    this._handles = [];
    this._queue.clear();
    this._freshDetails.clear();
    this._activeSettles.clear();
    this._fetchStates = {};
    this._pendingPreviewWrites = {};
    this._pendingDetailWrites = {};
    const error = new Error("Fetch engine stopped");
    for (const waiter of this._pendingFetches.values()) {
      waiter.reject(error);
    }
    this._pendingFetches.clear();
    this.setStatus({ dbStats: kInitialStats });
  }

  public isStarted(): boolean {
    return this._deps !== undefined;
  }

  /** The current listing (what the sink last activated). */
  public listing(): LogHandle[] {
    return this._handles;
  }

  /**
   * Get a log's details at the given priority: an enqueue-or-bump on the
   * shared queue, never a separate code path. Read-through: a cached row for
   * a completed log resolves immediately (seeding the cache) and a fresh
   * read is scheduled in the background; a cached *running* log is only
   * provisional, so the promise waits for the fresh read. `opts.fresh` skips
   * the immediate cache resolution outright (the caller knows the cached row
   * is stale, e.g. after editing the log), so the promise always waits for
   * the network read. Concurrent calls for the same log share one fetch.
   *
   * `opts.passive` (default false = active) marks ensure-presence demand: a
   * passive caller wants the data to exist, not to declare "someone is
   * looking at this" — it never bumps `details_settled_seq` and, on a cache
   * hit, never re-enqueues a background refresh. An active call sharing an
   * in-flight passive fetch upgrades it (the settle still bumps).
   */
  public fetch(
    logFile: string,
    priority: FetchPriority,
    opts: { fresh?: boolean; passive?: boolean } = {}
  ): Promise<void> {
    this.requireDeps();
    const key = this.resolveKey(logFile);
    if (!opts.passive) {
      this._activeSettles.add(key);
    }
    const pending = this._pendingFetches.get(key);
    if (pending) {
      if (opts.fresh) {
        // The in-flight attempt already consumed its own fresh flag at read
        // time; re-arm it so the NEXT fetch (not this joined one) honors it
        // — erring fresh rather than silently dropping the request.
        this._freshDetails.add(key);
      }
      if (!this._inFlightDetails.has(key)) {
        this._queue.enqueue(
          [detailsWork({ name: key })],
          toWorkPriority(priority)
        );
      }
      return pending.promise;
    }
    const waiter = deferred<void>();
    this._pendingFetches.set(key, waiter);
    void this.beginFetch(key, priority, waiter, opts.fresh ?? false);
    return waiter.promise;
  }

  /**
   * Enqueue-or-bump a preview fetch, fire-and-forget — hooks read the result
   * off the sink/cache rather than awaiting a promise here.
   */
  public requestPreview(logFile: string, priority: FetchPriority): void {
    this.requireDeps();
    const key = this.resolveKey(logFile);
    this._queue.enqueue([previewWork({ name: key })], toWorkPriority(priority));
  }

  private async beginFetch(
    key: string,
    priority: FetchPriority,
    waiter: Deferred<void>,
    fresh: boolean
  ): Promise<void> {
    const deps = this._deps;
    if (!deps) {
      // Stopped since the sync `fetch()` call; `stop()` rejected the waiter.
      return;
    }
    const cached =
      !fresh && deps.database
        ? await deps.database.readLogDetailsForFile(key)
        : null;
    if (this._pendingFetches.get(key) !== waiter) {
      return;
    }
    if (cached && cached.status !== "started") {
      this.ensureListed(key);
      deps.sink.mergeDetails({ [key]: cached });
      deps.sink.mergePreviews({ [key]: toLogPreview(cached) });
      this._pendingFetches.delete(key);
      // Consult `_activeSettles` live (not a `passive` flag captured at call
      // start) so an active fetch that joined this same pending fetch while
      // the db read above was in flight still gets credit — the set, not the
      // originating call, is the source of truth for "does this settle count
      // as active demand."
      const active = this._activeSettles.delete(key);
      waiter.resolve();
      if (!active) {
        // Ensure-presence only: the data exists, so resolve — but nobody
        // actively wants this log open, so no "landed" signal and no
        // background refresh (an active fetch later triggers both).
        return;
      }
      // A cache hit is a waitered success settle too — without this bump,
      // already-cached logs never signal "landed" and settle-seq consumers
      // (LogLoadController) hang on their guard. The background refresh below
      // completes unwaitered and correctly does not bump.
      this.bumpDetailsSettledSeq(key, deps);
      // The row may be stale (e.g. edited server-side since it was cached);
      // refresh in the background at the caller's priority.
    }
    this._freshDetails.add(key);
    this._queue.enqueue([detailsWork({ name: key })], toWorkPriority(priority));
  }

  /**
   * A successfully fetched log must appear in the listing even when no
   * discovery produced it (single-file mode; a deep link ahead of the first
   * sync) — seed a bare cache-only handle for it. Discovery later replaces
   * the listing wholesale, so the seed never leaks into the database.
   */
  private ensureListed(key: string): void {
    if (!this._handles.some((handle) => handle.name === key)) {
      this._handles = [...this._handles, { name: key }];
      this._deps?.sink.setHandles(this._handles);
    }
  }

  /**
   * Apply a replication discovery result: clear deleted/invalidated files
   * (and drop their queued work), activate the listing, then backfill —
   * invalidated and (in synced mode) missing details at High priority,
   * missing/interrupted previews in a High first wave with a Medium tail.
   * Returns the full activated listing.
   */
  public async applyListing(update: ListingUpdate): Promise<LogHandle[]> {
    const deps = this.requireDeps();

    const stale = [...update.deleted, ...update.invalidated];
    if (stale.length > 0) {
      this._queue.removeByIds(
        stale.flatMap((name) => [
          workId("preview", name),
          workId("details", name),
        ])
      );
      // A deleted file's queued work is gone for good (invalidated files get
      // re-enqueued below), so any fetch() waiter would otherwise hang.
      for (const name of update.deleted) {
        const waiter = this._pendingFetches.get(name);
        if (waiter && !this._inFlightDetails.has(name)) {
          this._pendingFetches.delete(name);
          this._activeSettles.delete(name);
          waiter.reject(new Error(`Log file deleted: ${name}`));
        }
      }
      await Promise.all(
        stale.map((name) => deps.sink.clearFile(name).catch(() => {}))
      );
      // The row is wiped alongside the file's other cached content — an
      // invalidated (changed) file's backfill gating naturally resets.
      stale.forEach((name) => {
        delete this._fetchStates[name];
      });
    }

    let full: LogHandle[];
    if (update.persistListing) {
      full = await deps.sink.writeHandles(update.listing);
    } else {
      deps.sink.setHandles(update.listing);
      full = update.listing;
    }
    this._handles = full;

    const invalidatedSet = new Set(update.invalidated);
    const invalidated = full.filter((handle) =>
      invalidatedSet.has(handle.name)
    );

    // Previews enqueue first so their High-priority first wave sorts ahead
    // of the (also High, on a cold/synced listing) details backfill —
    // `claimNextBatch` breaks priority ties by insertion order, so a cold
    // listing's first claimed batch paints previews instead of starving them
    // behind every detail fetch.
    await this.queuePreviewBackfill(full, invalidated);
    await this.queueDetailBackfill(full, invalidated, update.persistListing);
    this._throttledUpdateDbStats();
    return full;
  }

  /**
   * Seed the cache with any persisted previews and queue fetches for logs
   * without a settled ("success") preview — the whole listing, or just
   * `logs`.
   */
  public async ensurePreviews(logs?: LogHandle[]): Promise<void> {
    const deps = this.requireDeps();
    const all = (await deps.database?.readLogs()) ?? this._handles;
    const loaded = (await deps.database?.readLogPreviews(all)) ?? {};
    const filtered = (logs ?? all).filter(
      (log) => loaded[log.name]?.status !== "success"
    );
    if (Object.keys(loaded).length > 0) {
      deps.sink.mergePreviews(loaded);
    }
    if (filtered.length > 0) {
      this._queue.enqueue(filtered.map(previewWork), WorkPriority.High);
    }
  }

  /** Clear all cached log data (database + cache). */
  public clearData(): void {
    const deps = this.requireDeps();
    void deps.sink.clearAll().catch(() => {});
    this._handles = [];
    this._fetchStates = {};
    this._throttledUpdateDbStats();
  }

  // --- status (external store; consumed via useFetchEngineStatus) ---

  public subscribeStatus = (listener: () => void): (() => void) => {
    this._statusListeners.add(listener);
    return () => {
      this._statusListeners.delete(listener);
    };
  };

  public getStatus = (): FetchEngineStatus => this._status;

  private setStatus(patch: Partial<FetchEngineStatus>): void {
    this._status = { ...this._status, ...patch };
    this._statusListeners.forEach((listener) => listener());
  }

  // --- internals ---

  private requireDeps(): FetchEngineDeps {
    if (!this._deps) {
      throw new Error("Fetch engine used before start()");
    }
    return this._deps;
  }

  /**
   * Resolve a log file (which may be a suffix of a listed name) to the key
   * the listing uses, falling back to the file itself when it isn't listed
   * (e.g. single-file mode).
   */
  private resolveKey(logFile: string): string {
    const match = this._handles.find((handle) => handle.name.endsWith(logFile));
    return match?.name ?? logFile;
  }

  private processingChanged = (processing: boolean) => {
    this._processingCount += processing ? 1 : -1;
    const syncing = this._processingCount > 0;
    if (syncing !== this._status.syncing) {
      this.setStatus({ syncing });
    }
  };

  private attemptsFor(name: string, kind: LogWorkKind): number {
    const row = this._fetchStates[name];
    if (!row) {
      return 0;
    }
    return kind === "preview" ? row.preview_attempts : row.details_attempts;
  }

  /**
   * Partition backfill candidates by prior fetch-state attempts: a file that
   * has settled-failed `kMaxFetchAttempts` times is skipped outright (it's
   * presumed broken, not transient); one with fewer prior failures is
   * demoted to Low priority so it can't crowd out never-tried files: `normal`
   * keeps the caller's already-decided priority.
   */
  private gateBackfill(
    handles: LogHandle[],
    kind: LogWorkKind
  ): { normal: LogHandle[]; retry: LogHandle[] } {
    const normal: LogHandle[] = [];
    const retry: LogHandle[] = [];
    for (const handle of handles) {
      const attempts = this.attemptsFor(handle.name, kind);
      if (attempts >= kMaxFetchAttempts) {
        continue;
      }
      (attempts > 0 ? retry : normal).push(handle);
    }
    return { normal, retry };
  }

  private async queueDetailBackfill(
    full: LogHandle[],
    invalidated: LogHandle[],
    persistListing: boolean
  ): Promise<void> {
    const seen = new Set(invalidated.map((handle) => handle.name));
    const missing = (await this.findMissingDetails(full)).filter(
      (handle) => !seen.has(handle.name)
    );
    if (invalidated.length > 0) {
      // An invalidated file changed on the server; a cache-tolerant read
      // (the client-api's memoized remote file) would re-serve the stale
      // snapshot it was invalidated to replace.
      invalidated.forEach((handle) => this._freshDetails.add(handle.name));
      this._queue.enqueue(invalidated.map(detailsWork), WorkPriority.High);
    }
    const { normal, retry } = this.gateBackfill(missing, "details");
    if (normal.length > 0) {
      this._queue.enqueue(
        normal.map(detailsWork),
        persistListing ? WorkPriority.High : WorkPriority.Medium
      );
    }
    if (retry.length > 0) {
      this._queue.enqueue(retry.map(detailsWork), WorkPriority.Low);
    }
  }

  private async queuePreviewBackfill(
    full: LogHandle[],
    invalidated: LogHandle[]
  ): Promise<void> {
    const deps = this.requireDeps();
    const tasks = [...invalidated];
    const seen = new Set(tasks.map((task) => task.name));

    const missing = (await this.findMissingPreviews(full)).filter(
      (handle) => !seen.has(handle.name)
    );
    const { normal, retry } = this.gateBackfill(missing, "preview");
    normal.forEach((handle) => {
      seen.add(handle.name);
      tasks.push(handle);
    });
    retry.forEach((handle) => seen.add(handle.name));

    // A preview persisted as "started" is a snapshot of a run that may have
    // finished since — drop it and re-fetch.
    const cached = (await deps.database?.readLogPreviews(full)) ?? {};
    for (const handle of full) {
      if (seen.has(handle.name)) {
        continue;
      }
      if (cached[handle.name]?.status === "started") {
        seen.add(handle.name);
        await deps.sink.clearPreview(handle.name).catch(() => {});
        tasks.push(handle);
      }
    }

    if (tasks.length > 0) {
      this._queue.enqueue(
        tasks.slice(0, kPreviewFirstWave).map(previewWork),
        WorkPriority.High
      );
      this._queue.enqueue(
        tasks.slice(kPreviewFirstWave).map(previewWork),
        WorkPriority.Medium
      );
    }
    if (retry.length > 0) {
      this._queue.enqueue(retry.map(previewWork), WorkPriority.Low);
    }
  }

  private async findMissingDetails(logs: LogHandle[]): Promise<LogHandle[]> {
    const database = this.requireDeps().database;
    return database ? database.findMissingDetails(logs) : logs;
  }

  private async findMissingPreviews(logs: LogHandle[]): Promise<LogHandle[]> {
    const database = this.requireDeps().database;
    return database ? database.findMissingPreviews(logs) : logs;
  }

  private async flushPreviewWrites(): Promise<void> {
    if (this._flushingPreviews) {
      return;
    }
    this._flushingPreviews = true;
    try {
      const updates = this._pendingPreviewWrites;
      this._pendingPreviewWrites = {};
      const deps = this._deps;
      if (!deps || Object.keys(updates).length === 0) {
        return;
      }
      await deps.sink.writePreviews(updates).catch(() => {});
      this._throttledUpdateDbStats();
    } finally {
      this._flushingPreviews = false;
    }
  }

  private async flushDetailWrites(): Promise<void> {
    if (this._flushingDetails) {
      return;
    }
    this._flushingDetails = true;
    try {
      const updates = this._pendingDetailWrites;
      this._pendingDetailWrites = {};
      const deps = this._deps;
      if (!deps || Object.keys(updates).length === 0) {
        return;
      }
      await deps.sink.writeDetails(updates).catch(() => {});
      this._throttledUpdateDbStats();
    } finally {
      this._flushingDetails = false;
    }
  }

  private async updateDbStats(): Promise<void> {
    const database = this._deps?.database;
    if (!database?.opened()) {
      return;
    }
    try {
      const [logCount, previewCount, detailsCount] = await Promise.all([
        database.countRows("logs"),
        database.countRows("logPreviews"),
        database.countRows("logDetails"),
      ]);
      this.setStatus({ dbStats: { logCount, previewCount, detailsCount } });
    } catch {
      // Stats are advisory; ignore read failures.
    }
  }
}

/**
 * Shared FetchEngine singleton — an app service, not client state, so it
 * lives as a module singleton (like `queryClient`). Born inert; `start(deps)`
 * injects its dependencies at the composition root.
 */
export const fetchEngine = new FetchEngine();
