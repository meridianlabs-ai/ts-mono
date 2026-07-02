# Viewer domain concerns & ownership

The ownership map for the inspect viewer's startup/data layer. Companion to
[replication-startup-modes.md](replication-startup-modes.md).

The map has three kinds of entries, and they are not interchangeable:

- **Subsystems** — owned concerns with a private interior and a narrow public
  surface. Interior concerns have exactly one consumer: their subsystem. Rules
  about them are structural (nothing outside can reach them), not policed.
- **Media** — shared infrastructure that subsystems write into and consumers
  read from (the react-query cache). A medium has writers and readers, so it
  can't be swallowed into either side.
- **Derivations** — values computed from other state, never imperatively set,
  with no owner (loading/error status).

The headline rule: **the log-data acquisition subsystem is the only code that
talks to the backend about log data** — listing, previews, and details alike.
Everything else either produces prioritized work into it or consumes results
from the media it feeds.

## Subsystems

### App configuration

The one currency for "how is this app configured": `api` instance,
`singleFileMode`, `loader`, `logFile`, versions, `logDir`/`absLogDir`. Single
cache entry `["app-config"]`.

**Surface** — `app_config/useAppConfig.ts` (`useAppConfig`, `AppConfigGate`,
`useApi` passthrough), `app_config/useLogDir.ts` (logDir accessors over the
config cache entry; the one post-resolution mutation is embedded VS Code
live-nav via `setLogRoot`), and the sanctioned non-React escape hatches on
`app_config/appConfig.ts` (`getAppConfig` asserting, `peekAppConfig` non-asserting).
Priority order for reading config: `useAppConfig` (or a passthrough like
`useApi`) → `useAppConfigAsync` → `resolveAppConfig` → `getAppConfig` /
`peekAppConfig`.

**Interior** (sole consumer: config resolution):

| Concern | What it is | Module |
|---------|------------|--------|
| Invocation log source | The log source named at invocation time (`?log_dir=`, `?log_file=`, `#logview-state`, none). Pure input; parsed exactly once by `resolveBootstrap()`, never consulted after config resolution. | `app_config/urlLogSource.ts` |
| Backend selection | Choosing the view-server / static-http / vscode api from the invocation. Pure function, invoked once during bootstrap. | `app_config/resolveApi.ts` |
| Single-file detection | Whether the invocation names a single log file. Exposed downstream only as the `singleFileMode` flag on resolved config. | `app_config/singleFileMode.ts` |
| Bootstrap config | The sync-knowable prefix of the config: `api`, `singleFileMode`, `loader`, `logFile`. Exists so the pre-gate boot path has something honest to read — its only consumers outside resolution are the composition roots (`main.tsx`, store init), which are exempt (see below). | `app_config/appConfig.ts` (`getBootstrap`) |

### Log-data acquisition

Owns **all** backend log-data reads, at both granularities: collection-level
(dir listing / discovery) and item-level (previews, details). Mode-independent:
alive in dir mode and single-file mode alike (the discovery interior is dormant
in single-file mode). Output flows through the `logsContent` sink into the
react-query cache, pairing each persistence write with its cache write so the
db ⟹ cache invariant holds.

**Surface** — the policy functions on `log_data/replicationControl.ts`
(`ensureFetchEngine` — activate for a dir, both modes; `syncLogs` — ensure
active then refresh the listing, the single entry point for
`<ReplicationController>` on mount and the re-sync triggers; `syncLogPreviews`;
`deactivateReplication` — stop discovery *and* the engine), plus
`fetchEngine.fetch(logFile, priority): Promise<LogDetails>` — "get this at the
highest priority" is an enqueue-or-bump, never a separate code path — and
`log_data/useFetchEngineStatus.ts` / `log_data/useLogsSync.ts` as the react
rim, together with the collection read accessors on `log_data/logsContent.ts`
(`useLogHandles` / `useLogPreviews` / `useLogDetails` / `useLogDetail` and the
non-React `getLogDetail`).
Consumers don't know a replicator exists; they say "be ready for this dir" and
"refresh the listing now".

**Interior** (sole consumers: each other):

| Concern | What it is | Module |
|---------|------------|--------|
| Fetch engine | The item-level fetch mechanism: priority `WorkQueue`s, in-flight dedupe (per-item completion promises), read-through cache over the local database, batched sink writes. Framework-free and dependency-injected (`api`, `database`, sink) — unit-testable with fakes (`log_data/fetchEngine.test.ts`); never imports react-query or zustand. Producer-ignorant: it doesn't know who enqueues. | `log_data/fetchEngine.ts` (singleton) |
| Local log database | Persistence of handles / previews / details (IndexedDB, per-dir). The engine is the sole reader; every write goes through the sink. | inside the engine; instance lifecycle in `log_data/databaseServiceInstance.ts` |
| Discovery (replication) | List the dir, diff against the known listing (new / changed / deleted), produce the result into the engine (`applyListing`). Calls `api.get_logs` — the collection-level half of the subsystem's backend access. No queues, no item fetching of its own. Keyed on `logDir`; UI-ignorant; dormant in single-file mode. | `log_data/replicationService.ts` |
| Engine status | `syncing` (queue activity) and `dbStats` — high-frequency ephemeral service status in an engine-owned external store, consumed via `useSyncExternalStore`. Neither zustand nor react-query. | `fetchEngine` store, surfaced by `log_data/useFetchEngineStatus.ts` |

### Selected-log lifecycle

Everything that follows from "the user is viewing this log".

**Surface** — the details query and `useRefreshLog`.

- **Details query** — react-query, keyed on `(logDir, selectedLogFile)`, with
  `queryFn: fetchEngine.fetch(logFile, "user")`; the engine's read-through
  makes a cached log settle instantly (with a background refresh). Refresh =
  invalidating this query — there is no imperative refresh path.
  (`state/selectedLogDetails.ts`)
- **Reaction controller** — the residual non-derivable side effects of the
  query settling: recording `loadedLog`, per-log score resets, workspace-tab
  default for empty logs. No fetching. Also keeps the pending-samples poll
  mounted for the whole time a log is open. (`LogLoadController`)
- **Pending-samples poll** — the running log's sample buffer (pending
  summaries + running metrics) as a poll-driven react-query query keyed on
  `(logDir, logFile)`. Nothing imperative: enablement derives from the
  selection and the log's live status, cadence from the server's refresh
  hint, teardown from the key changing. Each tick threads the previous etag
  and also produces the watched log into the acquisition surface at elevated
  priority — polling is only the policy of when to ask; acquisition is the
  details fetching. (`state/pendingSamples.ts`)

Polling lives here, not inside acquisition, deliberately: it is driven by UI
lifecycle (which log is open and running), and acquisition's interior stays
UI-ignorant. The sorting rule: *what* to acquire (discovery) is acquisition
interior; *when the UI wants it fresher* (polling, refresh-invalidation,
user-priority fetch) plugs into the surface from outside. "Producer" is not a
category that implies containment — UI-ignorant acquisition mechanism is.

### UI state (leaf)

Which log the user is viewing, filters, tabs, sample selection, grid state,
`loadedLog`, rehydration — zustand slices, and nothing else. Known only by
components/handlers; knows nothing below it; nothing writes into it from below
(engine status flows out through its own external store; the leaf rule has no
exceptions). Absolutizing a relative log name against the log dir is a
config-aware derivation and lives at the event-handler seam (`useSelectLogFile`
in `state/hooks.ts`), not in the slice.

## Media & derivations

- **React-query cache** — the server-data medium: handles, previews, details,
  pending samples, eval-set, versions; never in zustand. The log-list
  collections are fed by acquisition through its sink and read by the UI —
  two-sided cache entries, so the *medium* belongs to neither. The accessor
  code over those entries (`log_data/logsContent.ts` — the sink implementation
  and the read hooks) lives in acquisition as its output port; consumers read
  the hooks off the barrel.
- **Loading / error status** — derivations of `AsyncData`, never imperatively
  set. Log-open path: the selected-log query (`LogViewLayout` error panel +
  activity, `ApplicationNavbar` via `useSelectedLogLoading`). Listing path: the
  panels' sync query (`useLogsSync`) and engine `syncing`.

## Composition roots

`store.ts` `initializeStore` (`initDatabaseService`, `setXApi`, `main.tsx`'s
pre-gate bootstrap read) wire the subsystems: api, per-dir database, and the
`logsContent` sink into acquisition, for both modes (`ensureFetchEngine` does
the mode-aware start). **Roots are exempt from the containment rules** — they
construct interiors, so they may see constructors and pre-resolution state.
Nothing else is exempt.

## Awareness hierarchy

Arrows point at what a layer is allowed to know.

```
Components / handlers ──→ hooks only (useAppConfig/useApi/useLogDir/useEvalSet/
       │                  useSelectLogFile/useFetchEngineStatus/useStore)
       │                  zustand (UI-state leaf) lives here; knows nothing below
       ▼
Lifecycle controllers     AppConfigGate, ReplicationController, LogLoadController
       │                  (reactions to queries; no fetching)
       ▼
Server-data medium        react-query cache ←─ acquisition sink; queries:
       │                  selected-log details, pending samples, logs-sync,
       │                  eval-set
       ▼
Log-data acquisition      surface: ensureFetchEngine / syncLogs / deactivate /
       │                  fetch(logFile, priority) / status
       │                  interior: fetchEngine · database · discovery · status store
       ▼
App configuration         surface: useAppConfig / useLogDir / getAppConfig
                          interior: urlLogSource · resolveApi · singleFileMode ·
                          bootstrap (consumed once at resolution)
```

### Rules

- Lower layers never import upward; interiors never import outside their
  subsystem.
- Each subsystem is a directory (`app_config/`, `log_data/`) whose `index.ts`
  barrel exports exactly the public surface. External modules import only the
  barrel; everything else in the dir is subsystem-private (in-dir tests import
  modules directly). One deep-import exception:
  `state/samplePolling.test.ts` seeds config via `initAppConfig`. (It seeds
  the details collection via the barrel's `mergeDetails`, exported for that
  seeding; product code writes collections only through the sink.)
- React reaches down only through hooks or a subsystem surface (from
  controllers / event handlers).
- **Only acquisition talks to the backend about log data** — `api.get_logs`,
  `api.get_log_summaries`, `api.get_log_details` are called from its interior
  and nowhere else. Producers enqueue; consumers await `fetch()` promises or
  read queries. Priority is an argument, not an architecture.
- Containment is earned, not assumed. An interior placement requires: (a) the
  subsystem is the sole consumer, (b) the concern is conceptually subordinate —
  a mechanism of the subsystem's policy, and (c) for acquisition, the concern
  is UI-ignorant. Sole-consumership alone is not sufficient.
- App config has exactly one currency and one cache entry (`["app-config"]`);
  the invocation input is consumed once at resolution and never consulted
  after.
- **Nothing writes into zustand from below.**
- **Loading/error are derivations of `AsyncData`**, never imperatively set.
- Acquisition's interior stays UI-ignorant: the engine and discovery never read
  selection. "The selected log is responsive" is the details query fetching at
  `user` priority, which front-runs queued background work in the same queue.
- Freshness is engine policy: a cached completed log is served immediately and
  refreshed in the background; a cached *running* log is never served stale.
  On-demand refresh is query invalidation, which re-runs the same `fetch()`.

## Boundaries (outside acquisition, by design)

- **Sample-level data** — sample loading and sample-event polling
  (`get_log_sample`, `get_log_sample_data`) call the api directly via their own
  singleton (`state/samplePollingInstance.ts`), and the pending-samples query
  calls `get_log_pending_samples` directly from its queryFn. These are the
  standing exceptions to the headline rule (which covers log listing/previews/
  details). Acquisition's contract doesn't preclude a later sample-level engine
  as a sibling of the fetch engine in its interior; it just doesn't own one
  today.
- **Listing reads** — the log-list UI reads the passive `logsContent`
  collections and filters/sorts client-side. Serving the listing from a
  server-side query (and retiring the collections as the read path) is a
  possible future step; the sink is the only coupling that would move.
- **`loadedLog`** — recorded by the reaction controller as zustand UI state
  (navigation reads it), not derived from the query.
