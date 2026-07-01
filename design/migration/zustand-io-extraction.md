# Getting log-sync / IO out of the zustand store

## Context

The startup refactor unified api/single-file-mode/loader/logDir into one resolved
`AppConfig` and moved `syncLogs` out of the zustand slice into
`state/replicationControl.ts` (commit `96428ce0`). But the store still owns a lot
of IO/sync/replication orchestration that isn't UI state. This finishes that:
zustand keeps **UI state only**; replication / log-loading / polling / data
fetches live in the module layer (`replicationControl`, new loader/polling
modules) and react-query.

The module singletons the store already leans on — `DatabaseService`
(`databaseServiceInstance`), `ReplicationService` (`sync/replicationService`),
`samplePolling` (`samplePollingInstance`), and `replicationControl` — are the
destination layer. `getLogDir()` / `getAppConfig()` are the sanctioned non-react
accessors for that layer.

## Decisions (A–F)

- **A — `syncLogPreviews`** → move to `replicationControl` as a plain
  `syncLogPreviews(logs)` (keeps the try/catch over
  `replicationService.loadLogPreviews`). `useLogs.loadLogOverviews` calls it
  directly; drop the zustand action.

- **B — `setSelectedLogFile`** → split. The zustand action becomes pure UI state
  (set `selectedLogFile` + abs path). The "ensure the file is loadable"
  branch (sync-to-find / seed-a-handle) moves to the loader layer as
  `ensureSelectableLog(logFile)`. Drop the redundant `!singleFileMode` (replication
  only runs in dir mode, so `isReplicating()` already implies it) — this removes
  the last `getAppConfig` read from `logsSlice`.

- **C — `logSlice.syncLog`** → extract the loader into a non-zustand
  `state/logLoad.ts` (`loadLog(logFile)`: DB read → `get_log_details` →
  `logsContent.merge*` → start polling), driven by `LogLoadController`. The slice
  keeps only log UI state (`loadedLog`, selection).

- **D — `logPolling`** → module singleton `state/logPollingInstance.ts` (parallel
  to `samplePollingInstance`): `setLogPollingApi(api)` at store init,
  `getLogPolling()` accessor. Started by `loadLog` (C), cleaned up by
  `LogLoadController`. Reads `getLogDir()` at runtime.

- **E — `getAllCachedSamples` / `queryCachedSamples`** → **delete** (dead; zero
  callers, like `ensureReplication`).

- **F — `evalSet`** → react-query. New `useEvalSet()` keyed on `logDir`
  (`queryFn: getAppConfig().api.get_eval_set`). `SamplesPanel` / `LogsPanel` read
  it via the hook. Delete `syncEvalSetInfo`, `logs.evalSet`, and the
  `syncEvalSetInfo` entry in `useLogs.loadLogs`.

## New modules
- `state/logLoad.ts` — `loadLog(logFile)` (C).
- `state/logPollingInstance.ts` — `setLogPollingApi` / `getLogPolling` (D).
- `state/useEvalSet.ts` (or `app/server/useEvalSet.ts`) — `useEvalSet()` (F).
- `ensureSelectableLog(logFile)` — in the loader layer (B); likely `logLoad.ts`.

## Ordering (shared file is `logsSlice.ts`/`logSlice.ts`, so mostly sequential)
1. **E** delete dead queries (trivial, isolated).
2. **A** `syncLogPreviews` → replicationControl.
3. **F** `evalSet` → `useEvalSet`.
4. **C + D** the loader + polling singleton (coupled: `loadLog` starts polling).
5. **B** split `setSelectedLogFile` + `ensureSelectableLog` (uses the loader layer from C).

## Verification (per phase)
`pnpm typecheck` / `lint` / `format:check` / `test` in `apps/inspect`; plus the
`top-level-views` e2e after C/D/B. Update/replace affected unit tests
(`logSlice.test`, `samplePolling.test`, any logsSlice tests) and add tests for the
new `logLoad` / `useEvalSet` modules.

## Follow-up
Verify against `main` that replication + single-log loading are still correctly
ensured across all paths (see the note in `loglistgrid-tanstack.md`).
