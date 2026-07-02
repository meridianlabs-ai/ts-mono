# Viewer domain concerns & ownership

The one-owner map for the inspect viewer's startup/data layer: every material
domain concern, the module that owns it, and the awareness (layering) rules
that keep the owners honest. Companion to
[replication-startup-modes.md](replication-startup-modes.md). The headline
rule: **one fetch engine** owns all backend log-data acquisition; everything
else is a producer of prioritized work or a consumer of results.

## Domain concerns and their owners

| # | Concern | What it is | Owner |
|---|---------|------------|-------|
| 1 | Invocation log source | The log source named at invocation time (`?log_dir=`, `?log_file=`, `#logview-state`, none). Pure input; never consulted after config resolution. | `app/urlLogSource.ts` — parsed exactly once, by `resolveBootstrap()` |
| 2 | Bootstrap config | The sync-knowable prefix of the config: `api` instance, `singleFileMode`, `loader`, `logFile`. Exists so the pre-gate boot path (`main.tsx`, store init) has something honest to read. | `app/appConfig.ts` (`getBootstrap`) |
| 3 | Resolved app config | The one currency for "how is this app configured": bootstrap + versions + `logDir`/`absLogDir`. Single cache entry `["app-config"]`. | `app/appConfig.ts` (framework-free core) + `app/server/useAppConfig.ts` (react-query glue, `AppConfigGate`, `useApi` passthrough) |
| 4 | Backend selection | Choosing the view-server / static-http / vscode api from the invocation. Pure function, invoked once during bootstrap. | `client/api/index.ts` (`resolveApi`) |
| 5 | logDir identity | The resolved current log dir. The one post-resolution mutation is embedded (VS Code) live-nav (`setLogRoot`). | `app/server/useLogDir.ts` — accessors over the config cache entry |
| 6 | Log-data fetch engine | The one place backend log-list data (details, previews) is fetched. Owns the priority `WorkQueue`s, in-flight dedupe (per-item completion promises), the read-through cache over the local database, batched sink writes, and the engine status store. Public contract: `fetch(logFile, priority): Promise<LogDetails>` — "get this at the highest priority" is an enqueue-or-bump, never a separate code path. Mode-independent: alive in dir mode and single-file mode alike. Framework-free: `api`, `database`, and the cache sink are injected; the engine never imports react-query or zustand. | `state/fetchEngine.ts` (singleton `fetchEngine`) |
| 7 | Local log database | Persistence of handles / previews / details (IndexedDB, per-dir). **Engine-private**: the engine is the sole reader, and every write goes through the `logsContent` sink so the db ⟹ cache invariant holds. The composition roots only construct/open/close it. | inside the engine; instance lifecycle in `state/databaseServiceInstance.ts` |
| 8 | Replication | **Discovery**: list the dir, diff against the known listing (new / changed / deleted), and produce the result into the engine (`applyListing`). No queues, no fetching of its own. Keyed on `logDir`; absent in single-file mode. | `state/sync/replicationService.ts` (mechanism) + `state/replicationControl.ts` (policy: `syncLogs` / `ensureFetchEngine` / `deactivateReplication`); driven by `ReplicationController` and the panels' `useLogsSync` queries |
| 9 | Selected-log details | A react-query query keyed on `(logDir, selectedLogFile)` with `queryFn: fetchEngine.fetch(logFile, "user")`; the engine's read-through makes a cached log settle instantly (with a background refresh). Refresh = invalidating this query (`useRefreshLog`) — there is no imperative refresh path. The residual non-derivable side effects (recording `loadedLog`, per-log score/pending resets, workspace-tab default for empty logs, polling start) live in one reaction controller. | `state/selectedLogDetails.ts` (query) + `LogLoadController` (reactions) |
| 10 | Polling | Freshness scheduling for a running log — a *producer*: each tick enqueues the watched log into the engine at elevated priority. The engine is the fetching; polling is only the policy of when to ask. (Sample-buffer polling — `get_log_pending_samples` — and sample-level loading are outside the engine; see boundaries below.) | `state/logPolling.ts` via `state/logPollingInstance.ts`; `state/samplePollingInstance.ts` for sample level |
| 11 | Server-derived data | Handles, previews, details, eval-set, versions — reactively keyed react-query data; never in zustand. The log-list collections (`logsContent`) are fed by the engine through its sink. | react-query cache: `state/logsContent.ts` collections + `app/server/*` hooks (e.g. `useEvalSet`) |
| 12 | Engine status | `syncing` (queue activity) and `dbStats` — high-frequency ephemeral service status, exposed by an engine-owned external store and consumed via `useSyncExternalStore`. Neither zustand nor react-query is involved. | `fetchEngine` store + `state/useFetchEngineStatus.ts` |
| 13 | Loading / error status | Derivations of `AsyncData`, never imperatively set. Log-open path: the selected-log query (`LogViewLayout` error panel + activity, `ApplicationNavbar` via `useSelectedLogLoading`). Listing path: the panels' sync query (`useLogsSync`) and engine `syncing`. | derivation (no owner) |
| 14 | Log selection | Which log the user is viewing — UI state. Absolutizing a relative name against the log dir is a config-aware derivation and lives at the event-handler seam, not in the slice. | `logsSlice.selectedLogFile` (state) + `useSelectLogFile` in `state/hooks.ts` (derivation) |
| 15 | Ephemeral UI state | Filters, tabs, sample selection, grid state, `loadedLog`, rehydration. | zustand slices — and nothing else; nothing writes into zustand from below |

## Awareness hierarchy

Arrows point at what a layer is allowed to know.

```
L0  Invocation input        urlLogSource                (knows: nothing; consumed once)
L1  Config core             appConfig ─→ urlLogSource, resolveApi, singleFileMode
L2  Fetch engine            fetchEngine — owns queues + database reads + api use; sink injected
      producers ─→ engine:  replication (dir discovery), log polling (freshness)
      control seams:        replicationControl (ensureFetchEngine / syncLogs / deactivate)
L3  Server-data medium      react-query cache ←─ engine sink; app/server/* hooks ─→ config
                            queries: selected-log details, logs-sync, eval-set
L4  Lifecycle controllers   AppConfigGate, ReplicationController,
                            LogLoadController (reactions to the details query; no fetching)
L5  Components / handlers   ─→ hooks only (useAppConfig/useApi/useLogDir/useEvalSet/
                            useSelectLogFile/useFetchEngineStatus/useStore)

Leaf: zustand (UI state)    known by L5; knows nothing below it; nothing writes up into it
Composition roots: store.ts initializeStore (initDatabaseService, setXApi) and
                   replicationControl.ensureFetchEngine — wires the engine
                   (api, per-dir database, logsContent sink) for both modes
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
- **Exactly one concern calls `api.get_log_details` / `get_log_summaries`: the
  engine.** Producers enqueue; consumers await `fetch()` promises or read
  queries. Priority is an argument, not an architecture.
- **Exactly one concern touches the database: the engine** (the composition
  roots only open/close it, and the `logsContent` sink pairs each persistence
  write with its cache write).
- **Nothing writes into zustand from below** — engine status flows out through
  its own external store; the leaf rule has no exceptions.
- **Loading/error are derivations of `AsyncData`**, never imperatively set.
- The engine is framework-free and dependency-injected (api, database, sink) —
  unit-testable with fakes (`state/fetchEngine.test.ts`), no jsdom/react-query
  harness needed.
- Services stay UI-ignorant: the engine and replicator never read selection.
  "The selected log is responsive" is the details query fetching at `user`
  priority, which front-runs queued background work in the same queue.
- Freshness is engine policy: a cached completed log is served immediately and
  refreshed in the background; a cached *running* log is never served stale.
  On-demand refresh is query invalidation, which re-runs the same `fetch()`.

## Boundaries (out of the engine, by design)

- **Sample-level data** — sample loading and sample-buffer polling
  (`get_log_pending_samples`) call the api directly via their own singletons.
  The engine's contract doesn't preclude a later sample queue; it just doesn't
  own one today.
- **Listing reads** — the log-list UI reads the passive `logsContent`
  collections and filters/sorts client-side. Serving the listing from a
  server-side query (and retiring the collections as the read path) is a
  possible future step; the sink is the only coupling that would move.
- **`loadedLog`** — recorded by the reaction controller as zustand UI state
  (navigation reads it), not derived from the query.
