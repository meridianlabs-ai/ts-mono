import { LogHandle } from "@tsmono/inspect-common";
import { throttle } from "@tsmono/util";

import { ClientAPI, LogDetails, LogPreview } from "../client/api/types";
import { DatabaseService } from "../client/database";
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
 */
export interface LogsContentSink {
  setHandles(handles: LogHandle[]): void;
  mergePreviews(previews: Record<string, LogPreview>): void;
  mergeDetails(details: Record<string, LogDetails>): void;
  writeHandles(handles: LogHandle[]): Promise<LogHandle[]>;
  writePreviews(previews: Record<string, LogPreview>): Promise<void>;
  writeDetails(details: Record<string, LogDetails>): Promise<void>;
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

export class FetchEngine {
  private _deps: FetchEngineDeps | undefined = undefined;

  // The current listing, mirroring what the sink last activated. The engine's
  // own copy so key resolution and diffing need no cache/db round-trip.
  private _handles: LogHandle[] = [];

  private readonly _queue: WorkQueue<LogWork, LogWorkValue>;
  private _processingCount = 0;

  // Completion promises for `fetch()` callers, keyed by resolved log name.
  // An entry exists from enqueue until resolve/reject, so concurrent callers
  // share one fetch (in-flight dedupe).
  private readonly _pendingFetches = new Map<string, Deferred<LogDetails>>();
  // Names currently claimed by a worker (no longer in the queue) — a
  // duplicate `fetch()` must not re-enqueue these.
  private readonly _inFlightDetails = new Set<string>();
  // Names whose next fetch must bypass any server-side cache (cached=false).
  private readonly _freshDetails = new Set<string>();

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

  private async previewWorker(
    handles: LogHandle[]
  ): Promise<WorkResult<LogWorkValue>[]> {
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
    results: WorkResult<LogWorkValue>[],
    inputs: LogWork[]
  ): void {
    inputs.forEach((work, i) => {
      const result = results[i];
      if (!result) {
        return;
      }
      if (!result.ok) {
        // Task 3 records this per-file failure; for now it's visible but
        // doesn't block the rest of the batch from landing.
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
  }

  private async detailsWorker(
    handles: LogHandle[]
  ): Promise<WorkResult<LogWorkValue>[]> {
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
    results: WorkResult<LogWorkValue>[],
    inputs: LogWork[]
  ): void {
    const deps = this._deps;
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
      // now redundant.
      this._queue.removeByIds([workId("preview", name)]);
      if (waiter) {
        this._pendingFetches.delete(name);
        if (deps) {
          // Someone is waiting on this, so land it now rather than in the
          // next batched flush; repaint the listing preview from the fresh
          // status (a log cached as "started" may have since finished).
          this.ensureListed(name);
          void deps.sink.writeDetails({ [name]: detail }).catch(() => {});
          deps.sink.mergePreviews({ [name]: toLogPreview(detail) });
        }
        waiter.resolve(detail);
      } else {
        this._pendingDetailWrites[name] = detail;
        this._throttledFlushDetailWrites();
      }
    });
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
    await this.updateDbStats();
  }

  /** Drop dependencies, queued work, and pending waiters (rejected). */
  public stop(): void {
    this._deps = undefined;
    this._handles = [];
    this._queue.clear();
    this._freshDetails.clear();
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
   */
  public fetch(
    logFile: string,
    priority: FetchPriority,
    opts: { fresh?: boolean } = {}
  ): Promise<LogDetails> {
    this.requireDeps();
    const key = this.resolveKey(logFile);
    const pending = this._pendingFetches.get(key);
    if (pending) {
      if (!this._inFlightDetails.has(key)) {
        this._queue.enqueue(
          [detailsWork({ name: key })],
          toWorkPriority(priority)
        );
      }
      return pending.promise;
    }
    const waiter = deferred<LogDetails>();
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
    waiter: Deferred<LogDetails>,
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
      waiter.resolve(cached);
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
          waiter.reject(new Error(`Log file deleted: ${name}`));
        }
      }
      await Promise.all(
        stale.map((name) => deps.sink.clearFile(name).catch(() => {}))
      );
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

    await this.queueDetailBackfill(full, invalidated, update.persistListing);
    await this.queuePreviewBackfill(full, invalidated);
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
    if (missing.length > 0) {
      this._queue.enqueue(
        missing.map(detailsWork),
        persistListing ? WorkPriority.High : WorkPriority.Medium
      );
    }
  }

  private async queuePreviewBackfill(
    full: LogHandle[],
    invalidated: LogHandle[]
  ): Promise<void> {
    const deps = this.requireDeps();
    const tasks = [...invalidated];
    const seen = new Set(tasks.map((task) => task.name));

    for (const handle of await this.findMissingPreviews(full)) {
      if (!seen.has(handle.name)) {
        seen.add(handle.name);
        tasks.push(handle);
      }
    }

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
