# Viewer domain ownership — target (aspirational)

Where the ownership map should end up. The current state is documented in
[domain-ownership.md](domain-ownership.md); this variant is the currency for
debating the next phase(s). The headline change: **one fetch engine** owns all
backend data acquisition; everything else is a producer of work or a consumer
of results.

## Target domain concerns and their owners

| # | Concern | What it is | Owner (target) |
|---|---------|------------|----------------|
| 1 | Invocation log source | Unchanged. Parsed once, dead after resolution. | `app/urlLogSource.ts` |
| 2 | Bootstrap config | Unchanged. | `app/appConfig.ts` (`getBootstrap`) |
| 3 | Resolved app config | Unchanged: one currency, one cache entry. | `app/appConfig.ts` + `app/server/useAppConfig.ts` |
| 4 | Backend selection | Unchanged. | `client/api/index.ts` (`resolveApi`) |
| 5 | logDir identity | Unchanged. | `app/server/useLogDir.ts` |
| 6 | **Log-data fetch engine** | **New.** The one place backend log data (details, previews) is fetched. Owns the priority `WorkQueue`s, dedupe (in-flight promise sharing), the single write path (DB + cache sink), and per-item completion promises. Public contract: `fetch(logFile, priority): Promise<LogDetails>` — "get this data at the highest priority" is an enqueue-or-bump, not a separate code path. Mode-independent: alive in dir mode and single-file mode alike. Framework-free: `api`, `database`, and a cache **sink** (the `logsContent` write surface as callbacks) are injected at the composition root; the engine never imports react-query or zustand. | `state/fetchEngine.ts` (name TBD) |
| 7 | Local log database | Persistence of handles/previews/details. **Engine-private**: the engine is the sole writer and read-through-cache reader; no other concern touches the DB. | internal to the fetch engine |
| 8 | Replication | **Narrowed to discovery**: list the dir, detect new/changed/deleted logs, invalidate, persist handles — then *produce* work into the engine at background priority. No queues, no fetching of its own. Still keyed on `logDir`, still absent in single-file mode. | `state/sync/replicationService.ts` (slimmed) + `replicationControl.ts`; driven by `ReplicationController` |
| 9 | Single-log load | **Dissolved.** Selected-log details become a react-query query: `queryFn: () => engine.fetch(logFile, "user")`. The residual orchestration (`setLoadedLog`, tab reset, polling start) becomes reactions to that query, not an imperative sequence. `ensureSelectableLog`'s await-a-full-sync dance disappears — `fetch(logFile)` needs no prior listing entry. | the query + small controller reactions |
| 10 | Polling | Freshness of running logs — a *producer*: on interval, enqueue the watched log into the engine at elevated priority. No direct api calls. | polling singletons (slimmed) |
| 11 | Server-derived data | Unchanged medium: react-query, reactively keyed, fed by the engine through the sink. | react-query cache + `app/server/*` hooks |
| 12 | Loading status | **Deleted as owned state.** Loading is derived from `AsyncData` on the relevant queries; the dormant `appSlice.status` machinery is removed. Errors surface as query errors. | derivation (no owner) |
| 13 | Replication/engine status | `syncing`, `dbStats`, progress — exposed reactively by the engine/replication (not written into zustand); UI reads it like any other async data. Kills the `replicationContext` → zustand impurity. | fetch engine (exposed via a hook) |
| 14 | Log selection | Unchanged: UI state + `useSelectLogFile` absolutization. Selection's *effect* is reactive — the details query is keyed on it — not an imperative controller call. | `logsSlice` + `state/hooks.ts` |
| 15 | Ephemeral UI state | Unchanged: zustand, and nothing else. `logSlice.pollLog`'s reach into the polling singleton goes away with #10. | zustand slices |

## Target awareness hierarchy

```
L0  Invocation input      urlLogSource                 (knows: nothing; consumed once)
L1  Config core           appConfig ─→ urlLogSource, resolveApi, singleFileMode
L2  Fetch engine          owns queues + DB + api use; sink injected
      producers ─→ engine:  replication (dir discovery), polling (freshness)
L3  Server-data medium    react-query cache ←─ engine sink; app/server/* hooks ─→ config
L4  Lifecycle controllers AppConfigGate, ReplicationController (fewer than today —
                          LogLoadController dissolves into queries/reactions)
L5  Components / handlers ─→ hooks only
Leaf: zustand (UI state)  known by L5; knows nothing below it; nothing writes up into it
Composition root: store.ts/main — wires engine (api, db, sink) and producer seams
```

### Rules (deltas from current in bold)

- Lower layers never import upward; React reaches down only through hooks or a
  control seam.
- Invocation input consumed once; config has one currency and one cache entry.
- **Exactly one concern calls `api.get_log_details`/preview fetches: the
  engine.** Producers enqueue; consumers await promises or read queries.
  Priority is an argument, not an architecture.
- **Exactly one concern touches the database: the engine.**
- **Nothing writes into zustand from below** — status flows reactively out of
  the engine; the leaf rule has no exceptions left.
- **Loading/error are derivations of `AsyncData`**, never imperatively set.
- The engine is framework-free and dependency-injected (api, database, sink) —
  unit-testable with fakes, no jsdom/react-query harness needed.

## What dissolves (vs current doc)

- All three "known gaps": duplicate fetch (dedupe by contract), discovery
  latency (no listing precondition), missing prioritization (the contract *is*
  prioritization).
- All three "known impurities": `replicationContext`→zustand status writes,
  `logSlice.pollLog`→singleton, `logLoad`→`isReplicating()` peer-awareness.
- Four scattered `get_log_details` call sites → one.
- `loadLog` / `refreshSelectedLog` imperative orchestration; the dormant
  loading-UI machinery (reimplemented as derivation).

## Decisions

- Engine name/home: **`state/fetchEngine.ts`**.
- **One engine**, two internal queues (previews, details).
- Polling: **separate producer**. Polling is the *scheduling policy* ("this log
  is running; ask again in N ms"); the engine is the *fetching*. The interval
  tick enqueues at elevated priority. (Engine-owned `watch(logFile)` is a
  possible later simplification, not this phase.)
- Post-load reactions: **derive everything derivable from the details query**
  (`loadedLog`-style facts, loading/error states); the residual non-derivable
  side effects (workspace-tab reset for empty logs, polling start/stop) live in
  **one small controller** that reacts to the query's `AsyncData` — the
  `LogLoadController` successor, minus all fetch orchestration.
- `dbStats`/`syncing` exposure: **engine-owned external store** consumed via
  `useSyncExternalStore` hook (`useFetchEngineStatus()`). It's high-frequency
  ephemeral status, not fetched server data — react-query is the wrong tool;
  zustand stays uninvolved.
- Sink shape: mirror the `logsContent` write surface — `writeHandles`,
  `writePreviews`, `writeDetails`, `clearFile`, `clearAll`. Since the DB is
  engine-private, replication's discovery results flow through narrow engine
  methods (e.g. `applyListing({updated, deleted})`, which persists, clears
  invalidated entries via the sink, and enqueues) rather than replication
  touching DB or cache itself.
- Sample-level data (samplePolling, sample loading): **out of scope** for this
  phase; details + previews only. The engine's contract should not preclude
  adding a sample queue later.
