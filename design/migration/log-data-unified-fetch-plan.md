# Unified Log Fetch Flow + Fetch-State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One flow acquires previews and details (shared priority queue, dedupe, per-item error isolation); retrieval errors are recorded per handle in IndexedDB; details become per-handle, db-backed, GC-able cache entries with a final `{data, loading, error}` contract; `useLogDetailQuery` is absorbed.

**Architecture:** `FetchEngine` keeps its role (sole fetcher, db-private, sink-mediated writes) but its two `WorkQueue`s collapse into one kind-tagged queue with global priority and kind-aware batching. A new `log_fetch_state` Dexie table records retrieval failures per handle; absence of a data row is no longer the only failure signal. Details move from a whole-dir `Record` collection to per-handle queries whose `queryFn` reads the Dexie row (invalidation-driven freshness, eviction re-seeds from db). Previews stay listing-shaped (transitional — see north star).

**Tech Stack:** TypeScript, react-query v5, Dexie (IndexedDB), vitest. All work in `apps/inspect` (+ `utils/workQueue.ts`).

## North star (colors this plan, not built here)

Log/sample counts will exceed what should be held in memory. Replication keeps populating IndexedDB; reads become paged `useInfiniteQuery` over Dexie with filter/sort. The scout reference (`apps/scout/src/app/transcripts/TranscriptsPanel.tsx` + `apps/scout/src/app/server/useServerTranscriptsInfinite.ts`) sets the read-model shape:

- **The listing is one paged query over the store**; rows are the page arrays (`data.pages.flatMap(p => p.items)`), NOT per-item cache subscriptions. Freshness = invalidate/refetch the paged query (`keepPreviousData` prevents flashing).
- **Per-entity cache entries exist only for the detail view**, keyed by id, GC-able because the db can always re-seed.

Consequences honored here:

- Details get their end-state cache shape NOW: `["log_data", "detail", logDir, name]`, db-backed `queryFn`, default gcTime (eviction desired — IndexedDB is the source of truth).
- Previews are NOT given per-handle entries (scout has none for list rows). The whole-dir previews collection remains as the degenerate un-paginated "single page" until the `useInfiniteQuery`-over-Dexie listing migration replaces it. Engine `requestPreview` is built now so that migration can bump visible rows.
- Fetch-state lives **in the db** so future paged listing queries can join/filter on it; its cache mirror is per-handle (detail-path consumers only).
- `LogDetails` embedding all `sampleSummaries` doesn't scale (a 200k-sample log would parse/hold every summary to show anything): direction is a **dedicated samples table** in Dexie, paged via `useInfiniteQuery` like the listing, with `LogDetails` shrinking toward header-only. Deferred — it changes the db schema, the `get_log_details` payload, and `sampleSummaries.ts` — but this plan must not entrench the embedding: nothing new reads `details.sampleSummaries` beyond today's consumers, and `LogDataState<T>` is deliberately generic so `useLogDetail`'s `T` can shrink without contract change.

## Data model

### Dexie tables (per-dir database `InspectAI_<sanitized dir>`, v10 after Task 3)

| Table | Record / pk | Indexes | Status |
|---|---|---|---|
| `logs` | `LogHandleRecord` / `++id` | `&file_path, mtime, task, task_id, cached_at` | unchanged — the listing index; future paged listing sorts/filters here |
| `log_previews` | `LogPreviewRecord` / `file_path` | `preview.status, preview.task_id, preview.model, cached_at` | unchanged — future paged listing joins it |
| `log_details` | `LogDetailsRecord` / `file_path` | `details.status, cached_at` | unchanged shape; still embeds `sampleSummaries` (shrinks toward header-only when the samples table lands — future) |
| `log_fetch_state` | `LogFetchStateRecord` / `file_path` | (pk only) | **new in Task 3** — per-handle retrieval errors/attempts; future paged listing joins it |
| `sample_summaries` | keyed `[file_path+id+epoch]`, sort/filter indexes | — | **future, not this plan** — paged sample summaries; carved out of `log_details` |

### RQ query keys (after this plan)

| Key | Value | Backing / lifecycle | Status |
|---|---|---|---|
| `["log_data", "sync"]` | listing sync trigger | queryFn `syncLogs`, poll-driven | unchanged |
| `["log_data", "client-events", logDir]` | server event poll | queryFn | unchanged |
| `["log_data", "handles", logDir]` | `LogHandle[]` | passive container, sink `setHandles` | transitional — folds into the paged listing |
| `["log_data", "previews", logDir]` | `Record<string, LogPreview>` | passive container, sink merges | **transitional** — the degenerate one-page listing; replaced by paged listing keys |
| `["log_data", "detail", logDir, name]` | `LogDetails \| null` | db-backed queryFn (Dexie row), sink guarded-push, `staleTime: Infinity`, default gcTime (evicts; db re-seeds) | **end-state (Task 4)** — key segment is the resolved handle name; supersedes `logDetailQuery`'s same-family key which used the raw route file arg |
| `["log_data", "fetch_state", logDir, name]` | `LogFetchStateRecord \| null` | db-backed queryFn, sink guarded-push | **new (Task 3), end-state** |
| `["log_data", "sample", logDir, logFile, id, epoch]` | `EvalSample` | queryFn fetch, gcTime 30s | unchanged |
| `["log_data", "running-sample", logDir, logFile, id, epoch]` | stream state | queryFn | unchanged |
| `["log_data", "pending-samples", logDir, logFile]` | pending-sample poll | queryFn | unchanged |
| `["log_data", "details", logDir]` | whole-dir `Record` | passive container, sink merges (dual-written alongside per-handle entries) | **transitional** — retained as the listing-shaped feed for samples mode / listing columns (`SamplesPanel`, `LogListGrid`, `columns/hooks` aggregate across all logs); removal belongs to the samples-table/paged migration |
| `["log_data", "listing", logDir, filter, orderBy, pageSize]` (infinite) | preview pages from Dexie | — | future, not this plan |
| `["log_data", "sample_summaries", logDir, name, filter, orderBy, pageSize]` (infinite) | summary pages from Dexie | — | future, not this plan |

## Global Constraints

- pnpm only; run `pnpm typecheck` / `pnpm test` from the ts-mono root (turbo). Iterate with `pnpm vitest run <file>` inside `apps/inspect`.
- No `any`, no type assertions.
- Vocabulary: retrieval/fetch errors ≠ eval errors. Schema/field names must say `fetch`/`retrieval`, never bare `error` (eval errors already live inside `LogPreview`/`LogDetails`).
- UI decision preserved: listing continues to omit rows whose preview retrieval failed; the selected-log ErrorPanel stays the only error UI. This plan records errors; new UI affordances are follow-up.
- Engine stays framework-free (no react-query/zustand imports in `fetchEngine.ts`).
- Commit per task in ts-mono; never push without asking.

---

### Task 1: WorkQueue — per-item results + kind-aware batching

Root cause of batch poisoning at the client layer: retries and drops are per-*batch*. Rework the contract so items settle individually, and batching becomes group-scoped so one queue can hold heterogeneous kinds.

**Files:**
- Modify: `apps/inspect/src/utils/workQueue.ts`
- Create: `apps/inspect/src/utils/workQueue.test.ts`

**Interfaces (produces):**

```ts
export type WorkResult<TOutput> =
  | { ok: true; value: TOutput }
  | { ok: false; error: Error };

interface WorkQueueOptions<TInput, TOutput> {
  name: string;
  concurrency: number;
  /** Items are batched only with same-group items; the head item's group wins. */
  batchGroup?: (item: TInput) => string;          // default: () => ""
  /** Max batch size for the head item's group. */
  batchSizeFor?: (item: TInput) => number;        // default: () => 1
  processingDelay?: number;
  maxRetries?: number;                            // per ITEM, default 3
  getId: (item: TInput) => string;
  /** Aligned with items. Throwing = every item in the batch failed. */
  worker: (items: TInput[]) => Promise<WorkResult<TOutput>[]>;
  /** Called once per batch with SETTLED items only (successes + final
   *  failures). Retryable failures are re-enqueued silently. */
  onComplete: (
    results: WorkResult<TOutput>[],
    inputs: TInput[]
  ) => Promise<void>;
  onProcessingChanged?: (processing: boolean) => void;
}
```

`claimNextBatch`: sort by `(priority desc, addedAt asc)`; take the head; extend with subsequent items whose `batchGroup` matches the head's, up to `batchSizeFor(head)`.

`runWorker` loop: on worker throw, synthesize `{ok: false, error}` for every item. Partition results: `!ok && retries < maxRetries` → `retries++`, re-add to queue (not reported); everything else → `onComplete(settledResults, settledInputs)` (arrays stay aligned).

- [ ] **Step 1: Write failing tests** covering: (a) per-item retry — batch of 3 where item B fails twice then succeeds: A and C settle on round 1, B settles on round 3, `onComplete` never sees B's retryable failures; (b) final failure reported — item failing `maxRetries+1` times reaches `onComplete` as `{ok: false}` exactly once; (c) group batching — queue `[p1, p1, d1, p1]` with groups `p|d`, `batchSizeFor` p→3, d→1: first claim is 3 p's, second is the d; (d) priority still wins across groups — a `User`-priority d item claims before `Medium` p items; (e) worker throw fails the whole batch but items retry individually.

```ts
// workQueue.test.ts — core of (a); write (b)–(e) in the same style
it("retries failed items individually, not the batch", async () => {
  const attempts = new Map<string, number>();
  const settled: Array<{ id: string; ok: boolean }> = [];
  const queue = new WorkQueue<string, string>({
    name: "t", concurrency: 1, processingDelay: 0, maxRetries: 3,
    batchGroup: () => "g", batchSizeFor: () => 3,
    getId: (s) => s,
    worker: async (items) =>
      items.map((s) => {
        const n = (attempts.get(s) ?? 0) + 1;
        attempts.set(s, n);
        return s === "B" && n < 3
          ? { ok: false as const, error: new Error("boom") }
          : { ok: true as const, value: s };
      }),
    onComplete: async (results, inputs) => {
      inputs.forEach((s, i) => settled.push({ id: s, ok: results[i]!.ok }));
    },
  });
  queue.enqueue(["A", "B", "C"]);
  await vi.waitFor(() => expect(settled).toHaveLength(3));
  expect(settled.every((s) => s.ok)).toBe(true);
  expect(attempts.get("B")).toBe(3);
});
```

- [ ] **Step 2:** `pnpm vitest run src/utils/workQueue.test.ts` — expect FAIL (old contract).
- [ ] **Step 3:** Implement the contract above. Delete `batchSize` option (callers migrate in Task 2; the branch's only caller is `fetchEngine.ts`).
- [ ] **Step 4:** `pnpm vitest run src/utils/workQueue.test.ts` — PASS. `fetchEngine.ts` won't compile yet — that's Task 2; do not commit a broken tree: Tasks 1+2 land as one commit if needed, or adapt `fetchEngine.ts` minimally here and refactor in Task 2.
- [ ] **Step 5:** Commit `feat(inspect): per-item WorkQueue results + grouped batching`.

---

### Task 2: FetchEngine — one queue, kind descriptors, preview bump, cross-kind coalesce

**Files:**
- Modify: `apps/inspect/src/log_data/fetchEngine.ts`
- Modify: `apps/inspect/src/log_data/replicationControl.ts` (export `requestPreview`)
- Modify: `apps/inspect/src/client/api/client-api.ts` (per-file fallback isolation)
- Modify: `apps/inspect/src/client/api/types.ts` (settled-summaries type)
- Test: `apps/inspect/src/log_data/fetchEngine.test.ts` (adapt + extend), `apps/inspect/src/client/api/client-api.test.ts`

**Interfaces:**
- Consumes: Task 1's `WorkResult`, `batchGroup`/`batchSizeFor`.
- Produces:
  - `engine.fetch(logFile: string, priority: FetchPriority, opts?: { fresh?: boolean }): Promise<LogDetails>` (existing semantics; `fresh` replaces the `_freshDetails` side-channel for callers).
  - `engine.requestPreview(logFile: string, priority: FetchPriority): void` — enqueue-or-bump, fire-and-forget (no waiter; hooks read the collection).
  - `replicationControl.fetchLog(logDir: string, logFile: string, opts?: { fresh?: boolean }): Promise<LogDetails>` — threads `opts` to `engine.fetch` (Task 4's invalidate path relies on it).
  - `replicationControl.requestPreview(logDir: string, logFile: string, priority?: FetchPriority): void` — activation-wrapped like `fetchLog`.
  - `ClientAPI.get_log_summaries_settled(files: string[]): Promise<WorkResult<LogPreview>[]>` (aligned with `files`).

**Design:**

```ts
type LogWorkKind = "preview" | "details";
interface LogWork { kind: LogWorkKind; handle: LogHandle; }
const workId = (kind: LogWorkKind, name: string) => `${kind} ${name}`;
```

One queue: `concurrency: options.concurrency ?? 6` (single global cap ≈ browser per-host pool; delete `previewConcurrency`/`detailConcurrency`), `batchGroup: (w) => w.kind`, `batchSizeFor: (w) => w.kind === "preview" ? (options.previewBatchSize ?? 24) : 1`, `processingDelay: 10`.

Worker dispatches by kind (the "kind descriptor" is this dispatch plus the per-kind `onComplete` handling — keep it as two small private methods, not an abstraction layer):
- `preview` batch → `api.get_log_summaries_settled(names)` (already per-file `WorkResult`s).
- `details` (always singleton) → existing per-file try/catch → `WorkResult<LogDetails>`.

`onComplete` per kind:
- preview success → pending preview writes (as today); preview failure → `console.error` (Task 3 records it).
- details success → existing waiter/batched-write logic, **plus cross-kind coalesce**: `queue.removeByIds([workId("preview", name)])` (the fetched details already repaint the preview via `toLogPreview`); details failure → reject waiter if present. Note: rejection happens after the queue's per-item retries are exhausted (uniform behavior across kinds — the DRY point of the unification; transient blips self-heal before surfacing). The fresh flag must survive retries: check without consuming in the worker, clear on final settle.

`client-api.ts` — replace the all-or-nothing fallback:

```ts
// TODO(better fix): /log-headers should return per-file success|error results
// (server: fastapi_server.py api_log_headers + read_eval_log_headers_async).
// Until then one unreadable file fails the whole batched request, so isolate
// failures client-side by falling back to per-file reads, each caught.
const get_log_summaries_settled = async (
  log_files: string[]
): Promise<WorkResult<LogPreview>[]> => {
  try {
    const summaries = await api.get_log_summaries(log_files);
    if (summaries.length === log_files.length) {
      return summaries.map((value) => ({ ok: true, value }));
    }
  } catch {
    // fall through to per-file reads
  }
  return Promise.all(
    log_files.map(async (file) => {
      try {
        return { ok: true as const, value: await read_one_summary(file) };
      } catch (e) {
        return {
          ok: false as const,
          error: e instanceof Error ? e : new Error(String(e)),
        };
      }
    })
  );
};
```

where `read_one_summary` reuses the existing per-file machinery (`read_eval_file_log_summary` for `.eval`, single-file `api.get_log_summaries` for `.json`). Keep `get_log_summaries` exported (VS Code/static implementations satisfy it); `get_log_summaries_settled` is a `client-api.ts`-level wrapper, not a new backend method.

- [ ] **Step 1: Adapt/extend `fetchEngine.test.ts` (failing first):** (a) existing suites compile against the new queue shape; (b) new: a `user`-priority `fetch()` claims before queued `Medium` preview backfill (order of api calls); (c) new: one bad file in a 24-preview batch → 23 previews land in the sink, none dropped; (d) new: details success removes the queued preview item for the same log (api.get_log_summaries_settled never called for it); (e) new: `requestPreview` dedupes with queued backfill (no double fetch).
- [ ] **Step 2:** `pnpm vitest run src/log_data/fetchEngine.test.ts` — FAIL.
- [ ] **Step 3:** Implement engine rework + `client-api.ts` wrapper + `replicationControl.requestPreview` (mirrors `fetchLog`: `await ensureFetchEngine(logDir); fetchEngine.requestPreview(logFile, priority ?? "user")` — but sync/fire-and-forget: `void ensureFetchEngine(logDir).then(...)`).
- [ ] **Step 4:** `pnpm vitest run src/log_data` and `pnpm vitest run src/client/api/client-api.test.ts` — PASS.
- [ ] **Step 5:** Root `pnpm typecheck && pnpm test` — PASS.
- [ ] **Step 6:** Commit `feat(inspect): unified log fetch queue with per-item error isolation`.

---

### Task 3: Fetch-state — schema v10, service, sink, engine recording, retry policy

**Files:**
- Modify: `apps/inspect/src/client/database/schema.ts` (v10, new table)
- Modify: `apps/inspect/src/client/database/service.ts`
- Modify: `apps/inspect/src/log_data/logsContent.ts` (collection + sink methods)
- Modify: `apps/inspect/src/log_data/fetchEngine.ts` (record/clear, backfill gating, start reset)
- Test: `apps/inspect/src/client/database/database.test.ts`, `apps/inspect/src/log_data/fetchEngine.test.ts`

**Interfaces (produces):**

```ts
// schema.ts — retrieval (fetch) state, NOT eval status/error (those live
// inside LogPreview/LogDetails). Absent row = no known retrieval problem.
export interface LogFetchStateRecord {
  file_path: string;                 // pk
  preview_fetch_error?: string;      // message of last preview retrieval failure
  preview_attempts: number;
  details_fetch_error?: string;
  details_attempts: number;
  /** Session-local settle counter for waitered (user) details fetches;
   *  cache-only in practice, harmless if persisted. */
  details_settled_seq: number;
  updated_at: string;
}
export const DB_VERSION = 10;
// stores: log_fetch_state: "file_path"
```

```ts
// service.ts
async writeFetchStates(states: Record<string, LogFetchStateRecord>): Promise<void>;
async readFetchStates(): Promise<Record<string, LogFetchStateRecord>>;
// deleteLog/clear paths also delete the file's fetch-state row
```

```ts
// logsContent.ts — fetch-state mirrors PER HANDLE (north star: the listing
// will consume fetch-state from Dexie via paged joins, not from the cache;
// the cache mirror serves detail-path consumers only).
export const logFetchStateKey = (logDir: string, name: string) =>
  ["log_data", "fetch_state", logDir, name] as const;
export const mergeFetchStates = (logDir, states: Record<string, LogFetchStateRecord>): void;   // cache-only, per-entry setQueryData
export const writeFetchStates = (db, logDir, states): Promise<void>;                            // db + cache
export const useLogFetchState = (
  logDir: string,
  name: string | undefined
): LogFetchStateRecord | undefined;  // per-handle subscription (skipToken when name undefined)
// LogsContentSink gains: mergeFetchStates, writeFetchStates
// clearFile/evictFile/clearAll also clear the fetch-state row(s): db delete +
// queryClient.removeQueries({ queryKey: logFetchStateKey(logDir, name) })
```

**Engine behavior:**
- On a settled *failure* (from Task 1's `onComplete`): upsert the file's fetch-state — set `<kind>_fetch_error = error.message`, increment `<kind>_attempts`, stamp `updated_at`. Applies to background AND waitered fetches (waiter still rejects too).
- On a settled *success*: if the file has a fetch-state row with that kind's error/attempts set, clear them (write only when needed — no churn). Details success with a waiter also increments `details_settled_seq` (cache-only `mergeFetchStates` is fine) — at EVERY waitered success settle, including `beginFetch`'s read-through cache-hit resolution, not just network completions in `onDetailsComplete`; otherwise the seq never fires for already-cached logs and `LogLoadController` goes dead on the majority path. Error rejections do not bump.
- Backfill gating (`queueDetailBackfill`/`queuePreviewBackfill`): partition `findMissing*` results by fetch-state: `attempts >= kMaxFetchAttempts (= 5)` → skip (recorded, gave up); `attempts > 0` → enqueue at `WorkPriority.Low`; else current priority. Invalidation (`clearFile`) wipes the row, so a changed file retries from scratch — the existing mtime invalidation is the natural reset.
- `start()`: after seeding collections, read fetch-states, zero all `*_attempts` (keep the error text), write back, and merge into cache — a restart retries everything once more but the last error stays visible until it's superseded.

- [ ] **Step 1: Failing tests.** `database.test.ts`: v10 round-trips `LogFetchStateRecord`; `clearFile`-path deletes it. `fetchEngine.test.ts`: (a) background preview failure → fetch-state row with `preview_fetch_error` + `preview_attempts: 1`, and NO preview row; (b) subsequent success clears it; (c) 5 failed attempts → file no longer enqueued by backfill, row retains error; (d) `clearFile` (invalidation) resets so backfill re-enqueues; (e) waitered details failure both rejects and records; (f) restart (`stop`/`start`) zeroes attempts, keeps error text.
- [ ] **Step 2:** Run both files — FAIL.
- [ ] **Step 3:** Implement schema + service + seam + engine changes.
- [ ] **Step 4:** Run both files — PASS. Root `pnpm typecheck && pnpm test` — PASS.
- [ ] **Step 5:** Commit `feat(inspect): record per-handle retrieval errors in fetch-state store`.

---

### Task 4: Details per-handle (db-backed, GC-able) + tri-state hook; absorb useLogDetailQuery

Details get their end-state cache shape for the detail-view path: one query per handle whose `queryFn` reads the Dexie row. Eviction is desired — IndexedDB re-seeds on remount. The whole-dir details `Record` collection is RETAINED as a transitional listing feed (samples mode and listing columns aggregate details across all logs: `SamplesPanel.tsx`, `LogListGrid.tsx`, `columns/hooks.tsx`) — the sink dual-writes it alongside guarded per-handle pushes, `start()` keeps its bulk seed, and its removal belongs to the samples-table/paged migration. (Previews likewise untouched — see north star.)

**Files:**
- Modify: `apps/inspect/src/log_data/logsContent.ts` (per-handle detail entries, sink rework, `useLogDetail` reshape; `useLogDetails`/`logDetailsKey` are RETAINED — see the amended intro above)
- Modify: `apps/inspect/src/log_data/fetchEngine.ts` (`start()` no longer bulk-seeds details into the cache — read-through `queryFn` replaced it; previews seed stays)
- Delete: `apps/inspect/src/log_data/logDetailQuery.ts`
- Modify: `apps/inspect/src/log_data/index.ts` (exports)
- Modify: `apps/inspect/src/log_data/imperativeLogData.ts` (`invalidateLogDetail` → engine refresh)
- Modify: `apps/inspect/src/state/selectedLogDetails.ts`
- Modify: `apps/inspect/src/app/routing/loaders/LogLoadController.tsx`
- Modify consumers: `apps/inspect/src/log_data/sampleSummaries.ts:50`, `apps/inspect/src/log_data/pendingSamples.ts:114`, `apps/inspect/src/log_data/runningSampleQuery.ts:207`, `apps/inspect/src/state/hooks.ts:172`
- Test: `apps/inspect/src/state/hooks.wiring.test.ts` (adapt), `apps/inspect/src/log_data/fetchEngine.test.ts` (seeding change)

**Interfaces (produces):**

```ts
/** Tri-state for db-backed log data. `error` is a RETRIEVAL error; eval
 *  errors are inside `data`. Contract is final. */
export interface LogDataState<T> {
  data: T | undefined;
  loading: boolean;          // file specified, no data, no retrieval error
  error: Error | undefined;
}

export const logDetailKey = (logDir: string, name: string) =>
  ["log_data", "detail", logDir, name] as const;
export const useLogDetail = (logDir: string, logFile: string | undefined): LogDataState<LogDetails>;
```

**Implementation:**

Sink internals (`mergeDetails`/`writeDetails` signatures unchanged for the engine):

```ts
// Push a fresh value to a handle's entry WITHOUT creating one: bulk backfill
// writing setQueryData unconditionally would materialize every log's details
// in memory, defeating GC. Unobserved/evicted keys re-seed from Dexie via the
// queryFn on next mount.
const pushDetail = (logDir: string, name: string, detail: LogDetails): void => {
  const key = logDetailKey(logDir, name);
  if (queryClient.getQueryCache().find({ queryKey: key })) {
    queryClient.setQueryData(key, detail);
  }
};

export const mergeDetails = (logDir, details): void => {
  Object.entries(details).forEach(([name, d]) => pushDetail(logDir, name, d));
};
export const writeDetails = async (db, logDir, details): Promise<void> => {
  Object.entries(details).forEach(([name, d]) => pushDetail(logDir, name, d));
  if (db?.opened()) {
    await db.writeLogDetails(details);
  }
};
// evictFile/clearFile/clearAll: db delete +
// queryClient.removeQueries({ queryKey: logDetailKey(logDir, name) })
```

The hook — a db-backed entry (evict/remount re-seeds from Dexie; sink pushes keep it fresh while observed) + demand + fetch-state:

```ts
export const useLogDetail = (logDir, logFile) => {
  const handles = useLogHandles(logDir);
  const key = logFile
    ? (handles.find((h) => h.name.endsWith(logFile))?.name ?? logFile)
    : undefined;
  const { data } = useQuery({
    queryKey: key ? logDetailKey(logDir, key) : logDetailKey(logDir, ""),
    // queryFn is the re-seed path only (staleTime: Infinity; sink pushes own
    // freshness). Returns null on miss — RQ forbids undefined.
    queryFn: key
      ? async () => {
          const db = getDatabaseService();
          return (db.opened() ? await db.readLogDetailsForFile(key) : null) ?? null;
        }
      : skipToken,
    staleTime: Infinity,
    // default gcTime: eviction desired, Dexie re-seeds
  });
  const fetchState = useLogFetchState(logDir, key);
  // Mount/arg-change = demand: engine read-through resolves instantly on a
  // db row and refreshes in the background; failures land in fetch-state.
  useEffect(() => {
    if (logFile) void fetchLog(logDir, logFile).catch(() => {});
  }, [logDir, logFile]);
  return useMemo(() => {
    const detail = data ?? undefined;
    const message =
      detail === undefined ? fetchState?.details_fetch_error : undefined;
    const error = message !== undefined ? new Error(message) : undefined;
    return {
      data: detail,
      loading: logFile !== undefined && detail === undefined && error === undefined,
      error,
    };
  }, [data, fetchState, logFile]);
};
```

`getLogDetail` (non-React snapshot for polling paths) becomes `queryClient.getQueryData(logDetailKey(logDir, key))` — it can now miss for evicted entries; its callers (`runningSampleQuery`, `sampleSummaries` polling) already treat `undefined` as "not resident," and the logs they poll are mounted (hot) in practice.

`useLogFetchState` entries use the same guarded-push + db-backed-queryFn pattern (Task 3).

`selectedLogDetails.ts`:

```ts
export const useSelectedLogDetail = (): LogDataState<LogDetails> =>
  useLogDetail(useLogDir(), useStore((s) => s.logs.selectedLogFile));
export const useSelectedLogLoading = (): boolean => useSelectedLogDetail().loading;
```

`LogViewLayout.tsx`: `const { loading: logLoading, error: logError } = useSelectedLogDetail();` — ErrorPanel rendering unchanged. `ApplicationNavbar` unchanged (via `useSelectedLogLoading`).

`LogLoadController.tsx`: replace the query-identity settle signal with the seq:

```ts
const logDir = useLogDir();
const selectedLogFile = useStore((s) => s.logs.selectedLogFile);
const detail = useLogDetail(logDir, selectedLogFile);
const key = selectedLogFile ? resolveLogKey(logDir, selectedLogFile) : undefined;
const settledSeq = useLogFetchState(logDir, key)?.details_settled_seq;
useEffect(() => {
  if (!selectedLogFile || detail.data === undefined || settledSeq === undefined) return;
  /* existing body: clearSelectedScores, empty-log tab default, setLoadedLog */
}, [settledSeq, selectedLogFile, /* actions */]);
```

(Deps intentionally exclude `detail.data` identity — poll-tick merges must NOT refire this effect; only waitered settles bump the seq, preserving the old query-settle semantics.)

`imperativeLogData.invalidateLogDetail(logDir, logFile)` → keep the name/callers (`state/actions.ts:53`), reimplement as `void fetchLog(logDir, logFile, { fresh: true }).catch(() => {})`.

Consumer updates are mechanical: `useLogDetail(...)?.sampleSummaries` → `useLogDetail(...).data?.sampleSummaries`, etc. `state/hooks.ts:172`'s `useSelectedLogDetails` keeps returning `LogDetails | undefined` (`.data`) so its own consumers don't churn.

**Behavior changes (intended, note in commit):**
- A db-cached `"started"` log now renders its provisional row immediately while the fresh read runs (old query blanked to loading until fresh). No stale-state risk: `LogLoadController` still waits for the settle seq.
- `sampleSummaries`/`pendingSamples`/`runningSampleQuery` mounting now also demand-fetch (engine dedupes; previously they relied on the selected-log query being mounted elsewhere).

- [ ] **Step 1: Adapt `hooks.wiring.test.ts` + add failing wiring tests:** (a) `useLogDetail` returns `error` when fetch-state has `details_fetch_error` and no data row; (b) returns `loading` when neither; (c) data row wins (error undefined even if a stale message exists); (d) mount triggers exactly one engine fetch per (dir, file) (dedupe via engine); (e) `useSelectedLogLoading` false when no file selected; (f) unmount past gcTime evicts, remount re-seeds from the Dexie row without an engine fetch settling first; (g) a background `writeDetails` for an unobserved log creates NO cache entry (guarded push).
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement; delete `logDetailQuery.ts`; fix `index.ts` exports; sweep consumers (`grep -rn "useLogDetailQuery\|useSelectedLogQuery"` must return nothing).
- [ ] **Step 4:** Root `pnpm typecheck && pnpm test` — PASS.
- [ ] **Step 5:** Manual verification (dir mode + single-file mode): open a log → renders; kill server mid-open → ErrorPanel; corrupt one log file in a dir → listing paints the other rows, no infinite refetch of the bad file (watch network tab), fetch-state row visible in IndexedDB devtools.
- [ ] **Step 6:** Commit `feat(inspect): tri-state log data hooks; absorb useLogDetailQuery`.

---

## Unresolved questions

- `kMaxFetchAttempts = 5` and Low-priority re-enqueue per sync tick — right numbers? No time-based backoff in this plan.
- Attempts reset on restart (keep error text) — confirm.
- Listing UI for errored rows (badge/filter) — follow-up, enabled by fetch-state but not built.
- Server `/log-headers` per-file result contract — follow-up in inspect_ai (python); client comment marks it.
- Dedicated samples table (a 200k-sample log shouldn't require parsing every summary out of the details row): direction agreed, schema/API split deferred — see north star. Affects `LogDetails` shape, `log_details` row size, and `get_log_details` payload; sample summaries would page from their own Dexie table.

## Self-review notes

- Task 1 leaves `fetchEngine.ts` uncompilable if committed alone — Tasks 1+2 may land as one commit; the plan calls this out.
- `details_settled_seq` is session-semantics stored alongside persisted fields; cache-only merge keeps it honest (db ⟹ cache invariant is one-directional).
- `WorkResult` lives in `utils/workQueue.ts`; `client-api.ts` imports it — acceptable (client-api already app-internal), revisit if `@tsmono/util` wants it.
