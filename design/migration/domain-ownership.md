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
talks to the backend about log data** — listing, previews, details, sample
data, and the pending-samples buffer alike. Everything else either produces
prioritized work into it or consumes results from the media it feeds.

The companion contract: **a data hook is called, returns data, and the data
stays current**. How it is kept fresh — polling, streaming, invalidation,
cache seeding, engine activation — is the implementing layer's private
concern. Above log_data exactly two imperative verbs survive: *invalidate*
(event handlers requesting freshness — `refreshLog`, `refreshLogListing`) and
*initialize* (composition roots). Everything else is declarative
subscription; no consumer kicks off lower-layer work from a lifecycle
effect, and no third party mounts a hook to keep data warm for others.

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

Owns **all** backend log-data reads, at every granularity — collection-level
(dir listing / discovery), item-level (previews, details), and sample-level
(completed bodies, event streaming, the pending-samples buffer) — **and all
the freshness mechanism behind them**: poll cadence, enablement mechanics,
etag threading, engine activation. Mode-independent: alive in dir mode and
single-file mode alike (the discovery interior is dormant in single-file
mode). Output flows through the `logsContent` sink into the react-query
cache, pairing each persistence write with its cache write so the db ⟹ cache
invariant holds.

**Surface** — param-driven data hooks, keyed on explicit
`(logDir, logFile, …)` arguments and selection-ignorant:

- `useLogsSync(scope)` (`log_data/useLogsSync.ts`) — sync the listing for a
  mounted panel; subscribing also keeps the listing fresh (a shared
  client-events poll re-syncs on host `refresh-evals` events and
  periodically). `refreshLogListing()` is the invalidation counterpart for
  external freshness events.
- `usePendingSamples(logDir, logFile)` (`log_data/pendingSamples.ts`) — a
  running log's sample buffer, polled while the log runs.
- `useSample(handle)` / `useCachedSample(handle)`
  (`log_data/sampleQuery.ts`) and `useRunningSample(handle, summary)`
  (`log_data/runningSampleQuery.ts`) — a sample's completed body / live
  event stream.
- the collection read accessors on `log_data/logsContent.ts`
  (`useLogHandles` / `useLogPreviews` / `useLogDetails` / `useLogDetail`) and
  `useFetchEngineStatus`.

plus the non-React policy functions on `log_data/replicationControl.ts`
(`fetchLog(logDir, logFile)` — user-priority details fetch, the queryFn
behind the selected-log query; `setReplicationApi` — composition-root
wiring; `syncLogs` stays in-subsystem as the queryFn behind `useLogsSync`),
and `mergeSampleSummaries` (log + pending-buffer summary normalization).
Consumers don't know a replicator or an engine exists; they subscribe to
data and it stays current.

**Interior** (sole consumers: each other):

| Concern | What it is | Module |
|---------|------------|--------|
| Activation lifecycle | `ensureFetchEngine(logDir)` — open the per-dir database, start the engine + discovery, idempotent and coalesced. Runs on demand inside every acquisition entry point (`syncLogs`, `fetchLog`); an ensure for a new dir tears the old activation down. No mount/cleanup bracket anywhere. | `log_data/replicationControl.ts` |
| Poll mechanics | Enablement derivations (`shouldPollPendingSamples`, `shouldStreamRunningSample`), cadence (server refresh hint / fixed intervals), etag threading, tick counters, the client-events tick. Polling lifetime = subscriber lifetime; no imperative start/stop. | `log_data/pendingSamples.ts`, `log_data/runningSampleQuery.ts`, `log_data/useLogsSync.ts` |
| Fetch engine | The item-level fetch mechanism: priority `WorkQueue`s, in-flight dedupe (per-item completion promises), read-through cache over the local database, batched sink writes. Framework-free and dependency-injected (`api`, `database`, sink) — unit-testable with fakes (`log_data/fetchEngine.test.ts`); never imports react-query or zustand. Producer-ignorant: it doesn't know who enqueues. | `log_data/fetchEngine.ts` (singleton) |
| Local log database | Persistence of handles / previews / details (IndexedDB, per-dir). The engine is the sole reader; every write goes through the sink. | inside the engine; instance lifecycle in `log_data/databaseServiceInstance.ts` |
| Discovery (replication) | List the dir, diff against the known listing (new / changed / deleted), produce the result into the engine (`applyListing`). Calls `api.get_logs` — the collection-level half of the subsystem's backend access. No queues, no item fetching of its own. Keyed on `logDir`; UI-ignorant; dormant in single-file mode. | `log_data/replicationService.ts` |
| Engine status | `syncing` (queue activity) and `dbStats` — high-frequency ephemeral service status in an engine-owned external store, consumed via `useSyncExternalStore`. Neither zustand nor react-query. | `fetchEngine` store, surfaced by `log_data/useFetchEngineStatus.ts` |
| Sample fetch | Completed-sample bodies: `fetchSample` wraps `api.get_log_sample` plus `resolveSample` normalization (attachment/pool-ref expansion, legacy-shape migration). Framework-free, api-injected, unit-tested with fakes. | `log_data/sampleFetch.ts` |
| Sample streaming | Per-sample streaming session over `api.get_log_sample_data`: cursors, message/call pools, event mapping, attachment + pool-ref resolution. `tick()` keeps the events-array identity stable across no-op ticks; `shouldFinalizeStreamingSample` / `hasSampleDataUpdates` are the finalize decisions. | `log_data/sampleStream.ts` |

### Selected-log lifecycle

Everything that follows from "the user is viewing this log" — thin
*selection bindings*: read the UI selection from zustand, delegate to a
param-driven log_data hook. No polling mechanics, no API calls, no cache
writes; a binding that grows a queryFn has sunk too low.

- **Details query** — react-query, keyed on `(logDir, selectedLogFile)`, with
  `queryFn: fetchLog(logDir, logFile)` (a user-priority engine fetch; the
  engine's read-through makes a cached log settle instantly with a background
  refresh). Refresh = invalidating this query — there is no imperative
  refresh path. (`state/selectedLogDetails.ts`)
- **Pending-samples binding** — `useSelectedPendingSamples()` delegates to
  `usePendingSamples(logDir, selectedLogFile)`. (`state/hooks.ts`)
- **Sample data derivation** — `useSampleData()` reads the selected handle
  and summary, delegating to `useSample` / `useRunningSample` /
  `useCachedSample`; the AsyncData-style seam the sample views consume.
  (`state/hooks.ts`)
- **Reaction controller** — the residual non-derivable side effects of the
  details query settling: recording `loadedLog`, per-log score resets,
  workspace-tab default for empty logs. No fetching. (`LogLoadController`)
- **Sample reaction controller** — resets per-sample UI state that isn't
  derivable from the new sample (scroll/list positions, collapsed events,
  timeline selection), keyed on sample identity. No fetching.
  (`SampleLoadController`)

The sorting rule: **freshness mechanism is acquisition interior; only
selection-awareness stays outside.** The deeper rule is unchanged —
acquisition never reads selection — because the log_data hooks take explicit
params and this layer binds them.

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
  sample bodies, running-sample streams, pending samples, flow, eval-set,
  versions; never in zustand. The log-list
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
pre-gate bootstrap read) wire the subsystems: api and database-service
lifecycle into acquisition, for both modes (activation itself is on-demand
inside acquisition — the first `syncLogs`/`fetchLog` does the mode-aware
start). **Roots are exempt from the containment rules** — they construct
interiors, so they may see constructors and pre-resolution state. Nothing
else is exempt.

## Awareness hierarchy

Arrows point at what a layer is allowed to know.

```
Components / handlers ──→ hooks only (useAppConfig/useApi/useLogDir/useEvalSet/
       │                  useSelectLogFile/useFetchEngineStatus/useStore)
       │                  zustand (UI-state leaf) lives here; knows nothing below
       ▼
Lifecycle controllers     AppConfigGate, LogLoadController, SampleLoadController,
       │                  SampleRouteSelectionController, ThemePreferenceSync-
       │                  Controller (reactions / irreducible effects; no fetching)
       ▼
Server-data medium        react-query cache ←─ acquisition sink; queries:
       │                  selected-log details, sample, running-sample,
       │                  pending samples, logs-sync, client-events, flow, eval-set
       ▼
Log-data acquisition      surface: data hooks (useLogsSync / usePendingSamples /
       │                  useSample / useRunningSample / collection reads) ·
       │                  syncLogs / fetchLog / refreshLogListing / status
       │                  interior: activation · fetchEngine · database · discovery
       │                  · poll mechanics · status store · sampleFetch · sampleStream
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
  modules directly). No test-only barrel exports — a test that needs a
  module's internals lives in the module's directory.
- React reaches down only through hooks or a subsystem surface (from
  controllers / event handlers).
- **Only acquisition talks to the backend about log data** — `api.get_logs`,
  `api.get_log_summaries`, `api.get_log_details`, `api.get_log_sample`,
  `api.get_log_sample_data`, `api.get_log_pending_samples`, and
  `api.client_events` are called from its interior and nowhere else — no
  exceptions. Producers enqueue; consumers await `fetch()` promises or read
  queries. Priority is an argument, not an architecture.
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

- **Listing reads** — the log-list UI reads the passive `logsContent`
  collections and filters/sorts client-side. Serving the listing from a
  server-side query (and retiring the collections as the read path) is a
  possible future step; the sink is the only coupling that would move.
- **`loadedLog`** — recorded by the reaction controller as zustand UI state
  (navigation reads it), not derived from the query.
