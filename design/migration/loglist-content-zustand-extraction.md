# Extracting zustand from the logs-content dataflow

Follow-on to `loglist-content-react-query.md`. Phase 2 moved the async log
*content* (handles/previews/details) into the react-query cache, but three
zustand ties remain in that dataflow. This plan removes them so **content has a
single owner (react-query) and a single key source**, the replication engine is
a plain singleton, and zustand keeps only genuine UI state.

## Status — ✅ all three phases done

Phases 1–3 implemented and committed. Dir mode verified (449 unit + 55 e2e green); `logDir` now flows from the gated `["log-dir"]` query via `<ReplicationController>`, and the `["logs-content",""]` empty key is gone. **Single-file / VS-Code-embed / deep-link mode is preserved by construction but not covered by e2e — needs a manual pass.** (`logs.logDir`/`absLogDir` have since been dropped — see the follow-up below.)

## Follow-up: single-file `logDir` → react-query — ✅ done

Single-file `logDir` now lives in the **same `["log-dir"]` react-query cache as dir mode**, seeded by `setLogDir` / `initLogDir` (single-file branch) instead of stored in zustand. `useLogDir`/`useAbsLogDir`/`getLogDir`/`getAbsLogDir` dropped their `isSingleFileMode` fork and read the cache uniformly; zustand `logs.logDir`/`absLogDir` and the `setLogDir` store action are retired (`setLogDir` is now a plain cache-seeder in `useLogDir.ts`). `selectedLogFile` stays in zustand (genuine selection/route state). The single-file loader is now `<SingleFileLoaderHost>` (takes `children`, provider-ready), parallel to `<DirModeLoaderHost>` under a trivial `<LoaderHost>` dispatch. See `replication-startup-modes.md` for the resulting startup flow.

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

### Phase 1 — replication context writes → direct `logsContent` (no lifecycle change)
- In the `ApplicationContext` built at `logsSlice.ts:320`, point the content callbacks (`setLogHandles`/`updateLogPreviews`/`updateLogDetails`) **directly** at `logsContent.*`, capturing the `logDir` that `startReplication` was invoked for (in scope at `logsSlice.ts:317`) instead of hopping through the zustand shim actions.
- Scope note: the three zustand shim actions (`logsSlice` `setLogHandles`/`updateLogPreviews`/`updateLogDetails`) **stay for now** — they're still used by `App.tsx:253`, the single-file path (`logsSlice.ts:406`), and the single-log slice (`logSlice.ts:220/231/270`), all of which read the current `logDir`. They retire in **Phase 3**, when `logDir` moves and those callers re-source it in one pass (repointing now then re-sourcing in Phase 3 is double work). Capturing the session's `logDir` here is also defensively correct against a dir switch (though Resolved #2 means none happens).
- No trigger/lifecycle change.

### Phase 2 — `ReplicationService` → module singleton (ownership only)
- Construct the service as a module singleton (export from `state/sync/`), drop `state.replicationService` from `store.ts`.
- Repoint callers to the import: `logsSlice` (`startReplication`/`sync`/`isReplicating`/`loadLogPreviews`), `ViewerOptionsPopover` (`clearData`).
- Trigger still `syncLogs` (still reads zustand `logDir`). No lifecycle change yet.

### Phase 3 — `logDir` → react-query + `<ReplicationController/>` (the lifecycle PR)
- Add `useLogDirAsync`/`useLogDir`. Host the `get_log_root` gate in **`AppLayout`'s dir-mode branch** (`routing/AppRouter.tsx`) — render a loading state until it resolves, then `<Outlet/>`. (`AppConfigGate` is unchanged; it still gates only global config.) The single-file branch keeps its route-derived `logDir`.
  - **`useLogDir` mechanics:** the `["log-dir"]` query has `enabled: !isSingleFileMode` (single-file never fetches `get_log_root`; the dir-mode gate is the only waiter). `useLogDir()` returns `isSingleFileMode ? <route-derived> : <query>.log_dir` (call both hooks unconditionally, pick by the stable module constant — no conditional-hooks violation). Non-React callers use `getLogDir()` = `isSingleFileMode ? deriveSingleFileLogDir(store.selectedLogFile) : queryClient.getQueryData(["log-dir"])?.log_dir`. `selectedLogFile` stays in zustand (it's selection/route state, not content). `absLogDir` comes off the same query value (`useAbsLogDir`/`getAbsLogDir`).
- Add `<ReplicationController/>` in that dir-mode branch (keyed conditional mount). Its effect: activate the per-dir IndexedDB (`initializeDatabase(logDir)`) → `singleton.startReplication(db, api, context(logDir))` → `sync()`; cleanup → `stopReplication()`. The context's content callbacks are the direct `logsContent(logDir)` calls from Phase 1; UI callbacks stay zustand actions.
- Retire `initLogDir`, `logs.logDir`, and the defensive `initLogDir`/`syncLogs` calls in `App`, `LogViewContainer`, `LogSampleDetailView`.
- Retire the three zustand content shim actions (deferred from Phase 1): repoint their remaining callers — `App.tsx:253` (single-file), `logsSlice.ts:406`, and the single-log slice (`logSlice.ts:220/231/270`) — to `logsContent.*` directly, sourcing `logDir` from the query (`useLogDir` in React, or `queryClient.getQueryData(["log-dir"])` in slice code).
- Cache key becomes `logsContentKey(useLogDir())` — this **resolves the `["logs-content",""]` / skipToken TODO** in `useLogsListingQuery`/`logsContent`. The only `skipToken` that legitimately remains is the no-root branch in the collection views.

## Careful bits (all in Phase 3)

- **StrictMode double-invoke:** `startReplication`+`sync` must be idempotent (preserve the `isReplicating`/`_pendingSync` guards); cleanup must truly `stop`. (Dev mount/unmount/mount → start/stop/start.)
- **`logDir` is stable at runtime** (see Resolved #2), so `["log-dir"]` with `staleTime: Infinity` resolves once and never churns; the controller mounts once. `key={logDir}` is defensive only — it'd handle a change correctly (cleanup-before-mount) but no path exercises one.
- **`useLogDirAsync`'s `queryFn` carries `initLogDir`'s two branches:** dir mode → `get_log_root()` (`{log_dir, abs_log_dir}`); single-file mode → derive from the selected file, falling back to `get_log_dir()`. Same logic, relocated into the query.
- **No-root / single-file mode:** `useLogDir() === undefined` → controller not mounted → collection views show an empty/redirect state (their own `skipToken`); the single-file path (`logsSlice.ts:302/406`) is preserved.

## Resolved (decisions confirmed against main)

1. **Gate scope** — gate `logDir` at the **router layer**, in `AppLayout`'s dir-mode branch (`routing/AppRouter.tsx`), *not* at `AppConfigGate`. `AppLayout` is below `RouterProvider` (so route params exist), already forks `isSingleFileMode`, and its dir-mode `<Outlet/>` branch encloses every collection/in-dir-log route and stays mounted across collection↔log navigation. So: `AppConfigGate` keeps gating global config (versions); the dir-mode branch hosts the `useLogDirAsync` (`get_log_root`) gate + `<ReplicationController>` and resolves `logDir` once for the dir-mode session. The single-file branch keeps its route-derived `logDir` and never waits on `get_log_root`. This avoids the gate-above-router collision (single-file `logDir` is route-derived and unknowable at `AppConfigGate`).
2. **Does `logDir` change at runtime? No.** No path mutates a live instance's `logDir`. Dir-mode `initLogDir` *re-calls* `get_log_root()` from `App`/`LogViewContainer`/`LogSampleDetailView` (unguarded), but always gets the server's fixed configured root, and `setLogDir` only fires on a real change (never). The one different-dir case — `backgroundUpdate` with `log_dir !== logDir` (`App.tsx:202`) — delegates to `api.open_log_file(...)` (a host/navigation action), not an in-place switch. ⇒ The react-query `["log-dir"]` query replaces N redundant fetches with one cached fetch — a strict improvement.
3. **Per-dir Dexie DB on switch — N/A.** No runtime dir switch (Resolved #2), so there's no teardown-on-switch scenario; the DB is activated once for the single resolved `logDir`.

## Retirement surface (audit during Phase 3)

- `logs.logDir` readers — every `useStore(s => s.logs.logDir)` → `useLogDir()`.
- `initLogDir` callers — `App.tsx`, `LogViewContainer.tsx`, `LogSampleDetailView.tsx`.
- `state.replicationService` users — `logsSlice`, `ViewerOptionsPopover`.

## Verification

- Per phase: typecheck / lint / format, unit, full e2e (especially `error-state`, `top-level-views`, and the transcript/timeline specs that open logs).
- Manual: cold load (IndexedDB hydrate → sync paint), single-file open (no-root), dev StrictMode double-mount sanity.
