# Extracting zustand from the logs-content dataflow

Follow-on to `loglist-content-react-query.md`. Phase 2 moved the async log
*content* (handles/previews/details) into the react-query cache, but three
zustand ties remain in that dataflow. This plan removes them so **content has a
single owner (react-query) and a single key source**, the replication engine is
a plain singleton, and zustand keeps only genuine UI state.

## The three remaining ties (today)

1. **Content write-shims** — `logsSlice` `setLogHandles`/`updateLogPreviews`/`updateLogDetails` (`logsSlice.ts:146/160/163`) just forward to `logsContent.*(get().logs.logDir, …)`. Pure indirection (the comment says so).
2. **`logDir`** — the react-query cache key, sourced by zustand `initLogDir()` → `api.get_log_root()` and read everywhere via `useStore(s => s.logs.logDir)`.
3. **The `ReplicationService` instance** — constructed in `store.initialize()` and stored as `state.replicationService` (`store.ts:127`). It's a server-replication helper, not client state.

UI state that legitimately **stays** in zustand: `loading`/`syncing`/`dbStats`/`selectedLog`/grid state.

## Decisions (locked)

- **`ReplicationService` → module singleton** (like `queryClient`). It's an engine, not UI state. Deps are still injected at `startReplication(db, api, context)` — the service is born inert, so nothing about its *creation* depends on `logDir`.
- **`logDir` → react-query**, via a gated pair `useLogDirAsync` / `useLogDir` mirroring `useAppConfig`. `useLogDirAsync` = `useAsyncDataFromQuery({ queryKey: ["log-dir"], queryFn: () => api.get_log_root(), staleTime: Infinity })`; gated in `AppConfigGate`. `useLogDir(): LogRoot | undefined` is the settled accessor — it branches on **`loading`/`error`** (the gate guarantees neither below it) and returns `data`, which may legitimately be `undefined` (no configured root). It must **not** use `useAppConfig`'s `if (!data) throw` shortcut — `undefined` is a valid value here, not "unloaded".
- **Content writes go directly to `logsContent.*(logDir, …)`** — no zustand hop.
- **Startup bridge = `<ReplicationController/>` component**, mounted below the gate:
  `{logDir ? <ReplicationController key={logDir} logDir={logDir} /> : null}`.
  Start on mount, stop on cleanup. `key={logDir}` makes a dir change a **remount** → React runs the old cleanup (`stop`) before the new mount (`start`), giving teardown-before-setup ordering for free. Absent root → not mounted → no collection replication (no in-effect branch needed). The boundary that reads `useLogDir()` is the only thing that re-renders on `logDir`; the controller is a null-returning leaf.

## Phases (sequenced to isolate risk)

### Phase 1 — content write-shims → direct `logsContent` (no lifecycle change)
- In the `ApplicationContext` built at `logsSlice.ts:320`, point the content callbacks (`setLogHandles`/`updateLogPreviews`/`updateLogDetails`) **directly** at `logsContent.*`, capturing the `logDir` that `startReplication` was invoked for (in scope at `logsSlice.ts:317`).
- Delete the three zustand shim actions; repoint other callers (`App.tsx:119`, the single-log slice).
- Side benefit: fixes a latent **misfile-on-switch** race — a late preview/detail batch currently flushes against `get().logs.logDir`, so it can land in the *new* dir's cache after a switch; capturing the session's own dir fixes that.
- No trigger/lifecycle change. Purely mechanical; ship + verify alone.

### Phase 2 — `ReplicationService` → module singleton (ownership only)
- Construct the service as a module singleton (export from `state/sync/`), drop `state.replicationService` from `store.ts`.
- Repoint callers to the import: `logsSlice` (`startReplication`/`sync`/`isReplicating`/`loadLogPreviews`), `ViewerOptionsPopover` (`clearData`).
- Trigger still `syncLogs` (still reads zustand `logDir`). No lifecycle change yet.

### Phase 3 — `logDir` → react-query + `<ReplicationController/>` (the lifecycle PR)
- Add `useLogDirAsync`/`useLogDir`; gate `AppConfigGate` on config **and** log-dir resolving.
- Add `<ReplicationController/>` below the gate (keyed conditional mount). Its effect: activate the per-dir IndexedDB (`initializeDatabase(logDir)`) → `singleton.startReplication(db, api, context(logDir))` → `sync()`; cleanup → `stopReplication()` (+ close the old DB). The context's content callbacks are the direct `logsContent(logDir)` calls from Phase 1; UI callbacks stay zustand actions.
- Retire `initLogDir`, `logs.logDir`, and the defensive `initLogDir`/`syncLogs` calls in `App`, `LogViewContainer`, `LogSampleDetailView`.
- Cache key becomes `logsContentKey(useLogDir())` — this **resolves the `["logs-content",""]` / skipToken TODO** in `useLogsListingQuery`/`logsContent`. The only `skipToken` that legitimately remains is the no-root branch in the collection views.

## Careful bits (all in Phase 3)

- **StrictMode double-invoke:** `startReplication`+`sync` must be idempotent (preserve the `isReplicating`/`_pendingSync` guards); cleanup must truly `stop`. (Dev mount/unmount/mount → start/stop/start.)
- **`logDir` is stable at runtime** (see Resolved #2), so `["log-dir"]` with `staleTime: Infinity` resolves once and never churns; the controller mounts once. `key={logDir}` is defensive only — it'd handle a change correctly (cleanup-before-mount) but no path exercises one.
- **`useLogDirAsync`'s `queryFn` carries `initLogDir`'s two branches:** dir mode → `get_log_root()` (`{log_dir, abs_log_dir}`); single-file mode → derive from the selected file, falling back to `get_log_dir()`. Same logic, relocated into the query.
- **No-root / single-file mode:** `useLogDir() === undefined` → controller not mounted → collection views show an empty/redirect state (their own `skipToken`); the single-file path (`logsSlice.ts:302/406`) is preserved.

## Resolved (decisions confirmed against main)

1. **Gate scope** — gate at `AppConfigGate` (block the whole app until log-dir is *resolved*; branch on *present* below it). Same spot as app-config.
2. **Does `logDir` change at runtime? No.** No path mutates a live instance's `logDir`. Dir-mode `initLogDir` *re-calls* `get_log_root()` from `App`/`LogViewContainer`/`LogSampleDetailView` (unguarded), but always gets the server's fixed configured root, and `setLogDir` only fires on a real change (never). The one different-dir case — `backgroundUpdate` with `log_dir !== logDir` (`App.tsx:202`) — delegates to `api.open_log_file(...)` (a host/navigation action), not an in-place switch. ⇒ The react-query `["log-dir"]` query replaces N redundant fetches with one cached fetch — a strict improvement.
3. **Per-dir Dexie DB on switch — N/A.** No runtime dir switch (Resolved #2), so there's no teardown-on-switch scenario; the DB is activated once for the single resolved `logDir`.

## Retirement surface (audit during Phase 3)

- `logs.logDir` readers — every `useStore(s => s.logs.logDir)` → `useLogDir()`.
- `initLogDir` callers — `App.tsx`, `LogViewContainer.tsx`, `LogSampleDetailView.tsx`.
- `state.replicationService` users — `logsSlice`, `ViewerOptionsPopover`.

## Verification

- Per phase: typecheck / lint / format, unit, full e2e (especially `error-state`, `top-level-views`, and the transcript/timeline specs that open logs).
- Manual: cold load (IndexedDB hydrate → sync paint), single-file open (no-root), dev StrictMode double-mount sanity.
