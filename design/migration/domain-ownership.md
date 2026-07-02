# Viewer domain concerns & ownership

The one-owner map for the inspect viewer's startup/data layer: every material
domain concern, the module that owns it, and the awareness (layering) rules
that keep the owners honest. Companion to
[reactive-refactor-goal.md](reactive-refactor-goal.md) and
[replication-startup-modes.md](replication-startup-modes.md).

## Domain concerns and their owners

| # | Concern | What it is | Owner |
|---|---------|------------|-------|
| 1 | Invocation log source | The log source named at invocation time (`?log_dir=`, `?log_file=`, `#logview-state`, none). Pure input; never consulted after config resolution. | `app/urlLogSource.ts` — parsed exactly once, by `resolveBootstrap()` |
| 2 | Bootstrap config | The sync-knowable prefix of the config: `api` instance, `singleFileMode`, `loader`, `logFile`. Exists so the pre-gate boot path (`main.tsx`, store init) has something honest to read. | `app/appConfig.ts` (`getBootstrap`) |
| 3 | Resolved app config | The one currency for "how is this app configured": bootstrap + versions + `logDir`/`absLogDir`. Single cache entry `["app-config"]`. | `app/appConfig.ts` (framework-free core) + `app/server/useAppConfig.ts` (react-query glue, `AppConfigGate`, `useApi` passthrough) |
| 4 | Backend selection | Choosing the view-server / static-http / vscode api from the invocation. Pure function, invoked once during bootstrap. | `client/api/index.ts` (`resolveApi`) |
| 5 | logDir identity | The resolved current log dir. The one post-resolution mutation is embedded (VS Code) live-nav (`setLogRoot`). | `app/server/useLogDir.ts` — accessors over the config cache entry |
| 6 | Local log database | The replicated store of handles / previews / details (IndexedDB). | `state/databaseServiceInstance.ts` singleton |
| 7 | Replication | Syncing the log dir into the database; activation keyed on `logDir`; skipped in single-file mode. Work ordered by priority-then-age `WorkQueue`s. | `state/sync/replicationService.ts` (mechanism) + `state/replicationControl.ts` (policy: `syncLogs` / `ensureActive` / `deactivateReplication`); driven by `ReplicationController` |
| 8 | Single-log load | Making one log selectable + loading its details (DB-cache-first, direct api fetch on miss); refresh. Bypasses the replication queues. | `state/logLoad.ts` (`loadLog`, `ensureSelectableLog`, `refreshSelectedLog`); driven by `LogLoadController` |
| 9 | Polling | Log-level and sample-level freshness watching. | `state/logPollingInstance.ts`, `state/samplePollingInstance.ts` singletons |
| 10 | Server-derived data | Handles, previews, details, eval-set, versions — reactively keyed; never in zustand. | react-query cache via `app/server/*` hooks (e.g. `useEvalSet`, keyed `["eval-set", logDir]`; its null↔undefined seam confined inside the hook) |
| 11 | Log selection | Which log the user is viewing — UI state. Absolutizing a relative name against the log dir is a config-aware derivation and lives at the event-handler seam, not in the slice. | `logsSlice.selectedLogFile` (state) + `useSelectLogFile` in `state/hooks.ts` (derivation) |
| 12 | Loading status | Imperative loading bracket — dormant: UI kept, never set; error channel remains. Future owner: derivation from `AsyncData` once loads are queries. | `appSlice.status` (zustand) — owner-in-waiting |
| 13 | Ephemeral UI state | Filters, tabs, sample selection, grid state, rehydration. | zustand slices — and nothing else |

## Awareness hierarchy

Arrows point at what a layer is allowed to know.

```
L0  Invocation input        urlLogSource                (knows: nothing; consumed once)
L1  Config core             appConfig ─→ urlLogSource, resolveApi, singleFileMode
L2  Services                database ←─ replication ←─ replicationControl; logLoad; polling
                            (know: config via getX accessors, each other downward, the DB)
L3  Server-data medium      react-query cache + app/server/* hooks ─→ config, services' output
L4  Lifecycle controllers   AppConfigGate, ReplicationController, LogLoadController
                            (know: L3 hooks + L2 control seams; they drive, keyed on reactive state)
L5  Components / handlers   ─→ hooks only (useAppConfig/useApi/useLogDir/useEvalSet/
                            useSelectLogFile/useStore)

Leaf: zustand (UI state)    known by L5; knows nothing below it
Composition root: store.ts initializeStore — the one place allowed to wire L2 seams
                            (initDatabaseService, setXApi)
```

### Rules

- Lower layers never import upward.
- React reaches down only through hooks (L3) or a control seam (L2, from
  controllers / event handlers).
- The invocation input is consumed once and never consulted post-resolution;
  everything downstream reads the resolved config.
- App config has exactly one currency and one cache entry (`["app-config"]`).
  Priority order for reading it: `useAppConfig` (or a passthrough like
  `useApi`) → `useAppConfigAsync` → `resolveAppConfig` → `getAppConfig`
  (sanctioned non-React escape hatch) / `peekAppConfig` (non-asserting).
- Services stay UI-ignorant: the replicator never reads selection; "the
  selected log is responsive" is owned by the `loadLog` bypass, which fetches
  directly and writes the same stores the replicator fills (idempotent
  convergence).

## Known impurities (deliberate, deferred)

- `replicationContext` pushes status (`syncing`, `dbStats`, the error channel)
  up into zustand — service→UI-state awareness that violates the leaf rule.
  Earmarked for the harden-the-boundaries pass.
- `logSlice.pollLog` reaches into the log-polling singleton (L2 from the leaf).
  Same bucket.
- `logLoad` consults `replicationService.isReplicating()` — L2 peer awareness;
  acceptable and documented, but it's the one touch point between the load
  path and the replicator.

## Known gaps (selection ↔ replication)

- **Duplicate fetch**: the `loadLog` bypass doesn't dequeue. If sync already
  queued the selected log's details (it queues all missing details High), the
  queue worker fetches them again — it calls `get_log_details` unconditionally,
  with no DB re-check. Harmless but wasteful.
- **Discovery latency**: selecting a file the listing doesn't know yet costs an
  awaited full-dir `syncLogs()` inside `ensureSelectableLog` before its details
  start loading.
- **No true prioritization**: nothing bumps the selected log in the replication
  queues (`queueLogDetails`/`queueLogPreviews` have no external callers). If
  ever required, the shape is an event-handler-seam call
  (`replicationControl.prioritize(logFile)`) that reorders/dequeues — keeping
  the service itself selection-ignorant.
