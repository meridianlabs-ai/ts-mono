# Viewer startup: API backends & replication init

Three concepts run through the doc:

1. **API backend** — `resolveApi()` runs at module load
   and picks the `ClientAPI` implementation. The chronologically-first decision.
2. **Single-file mode** — the `isSingleFileMode` boolean. Resolved once at startup from the URL
   or embedded state.
3. **Loader** — who fills the react-query content cache: the **replicator**
   or a **direct load**.

---

## Backend × Single-file mode at a glance

Single-file mode fixes the loader (directory = replicator, single-file = direct
load); each cell names the deployment / signal that lands there.

| Backend ↓ \ Single-file Mode → | `false`                                 | `true`                           |
| ------------------------------ | --------------------------------------- | -------------------------------- |
| `viewServerApi`                | default (`inspect view`)                | —                                |
| `staticHttpApi`                | `?log_dir=` · `#log_dir_context` bundle | `?log_file=`                     |
| `vscodeApi`                    | sidebar view (log_dir, no selection)    | `#logview-state` (VS Code embed) |

> **VS Code runs both modes.** The extension embeds a `#logview-state` only when
> a log is opened (single-file); the sidebar view carries a `log_dir` with nothing
> selected and injects no `#logview-state` (directory mode). `vscodeApi` implements
> `get_log_root`, so the directory loader resolves the dir there like any other
> backend.
>
> **Mutual exclusivity (enforced).** `?log_dir=` (directory mode) and `?log_file=`
> (single-file mode) name a directory vs. a single file — mutually exclusive.
> `parseUrlLogSource` (`app/urlLogSource.ts`) is the single parse of both params:
> it returns a discriminated union (`dir` | `file` | `none`) and **throws** on the
> contradictory combo, so backend selection (`resolveApi`) and single-file
> detection (`isSingleFileMode`) read one source and can't disagree.

---

## The two loaders

Which loader runs depends only on **single-file mode**. Either loader writes
content into the **react-query** cache (`state/logsContent.ts`), keyed by `logDir`.

### Replicator loader

The replicator fills the cache in three tiers, cheap to expensive:

- handles (enumerate the directory)
- previews (`get_log_summaries`)
- details

It batches into both **IndexedDB** (Dexie, for instant hydrate next load as well
as future advanced filtering/sorting queries) and the **react-query** cache; on
start it hydrates from IndexedDB, then `sync()` reconciles against the source and
fills gaps. Re-syncs (polling / `backgroundUpdate` / panel mount) repeat the
reconcile.

Startup wiring:

1. **(react)** `<AppLayout>` wraps its content (`<Outlet/>`) in `<LoaderHost>`;
   the dir-mode dispatch renders `<DirModeLoaderHost>`.
2. **(react-query)** `<DirModeLoaderHost>` calls `useLogRootAsync()` — the gated
   `["log-dir"]` query (`api.get_log_root()`, `staleTime: Infinity`) — and renders
   a loading state until it resolves.
3. **(react)** Resolved → `logDir = root.log_dir` →
   `<ReplicationController key={logDir} logDir={logDir} />` + `children` (the
   `<Outlet/>`).
4. **(react → module)** `<ReplicationController>`'s mount effect calls
   `activateReplication(logDir)`; cleanup calls `deactivateReplication()`. Both
   are plain module functions (`state/replicationControl.ts`), not zustand
   actions — the replicator is a module singleton, so the controller drives it
   directly with no store hop. `key={logDir}` makes a dir change a remount
   (clean stop → start).
5. **(module)** `activateReplication` opens the per-dir IndexedDB (the
   `DatabaseService` is itself a module singleton — `databaseServiceInstance.ts`
   — not zustand state), then `replicationService.startReplication(db, api,
logDir, replicationContext())`, then `sync(true)` — both pushing into the
   content cache via `logsContent.*(logDir, …)`, the `logDir` passed here being
   the gated value. `replicationContext()` is the one zustand touchpoint: it
   bridges replicator progress to UI state (`setLoading` / `setSyncing` /
   `setDbStats` actions).
6. **(react / react-query)** Collection views read with
   `useLogDetails(useLogDir())` etc.; `useLogDir()` returns the _same_ gated
   `log_dir`, so the key the views read matches what replication wrote.
7. **(zustand)** Re-syncs call `syncLogs()`, which sources the dir from
   `getLogDir()` (the cached query value, non-React) and re-activates defensively
   if not already running.

**zustand here:** UI state only — `loading`/`syncing`, `dbStats`,
`selectedLogFile`, grid state. Not `logDir`, not content, not the
`DatabaseService` or the replicator (both module singletons).

### Direct loader

One specific log, no directory, no background work. The single-log slice
(`logSlice`) loads the open log on demand into the **same** content cache.
No work queues, no directory-wide IndexedDB hydration, no polling — the
`ReplicationService` is **never started**. (Direct load ≠ no content: the open
log still reaches the cache; what's absent is the background, directory-wide
replication.)

Startup wiring:

1. **(react)** `<AppLayout>` computes the single-file content
   (`<LogViewContainer>` or `<LogSampleDetailView>`, by route params) and wraps it
   in `<LoaderHost>`; the dispatch renders `<SingleFileLoaderHost>` — no gate,
   **no `<ReplicationController>`**.
2. **(react → react-query)** `<SingleFileLoaderHost>`'s mount effect runs the
   `?log_file=` bootstrap: it selects the one log (`selectedLogFile` in zustand)
   and **seeds the `["log-dir"]` react-query cache** via `setLogDir` —
   `resolveSingleFileLogDir` derives the dir from the file (its own directory,
   falling back to `api.get_log_dir()`, then the page folder). The embedded-state
   / VS Code bootstrap stays in `<App>`'s `onMessage`, which seeds the same cache.
3. **(react-query — disabled)** The `["log-dir"]` query has
   `enabled: !isSingleFileMode`, so `get_log_root` never runs — the value is the
   seeded one, not a fetch.
4. **(module — idle)** The `ReplicationService` **never starts**: no controller,
   and `syncLogs()` bails immediately on `isSingleFileMode`.
5. **(react-query)** The open log's content is loaded on demand by the single-log
   slice (`logSlice`), keyed by `getLogDir()` (the seeded cache value).
6. **(react)** `useLogDir()` / `getLogDir()` read the `["log-dir"]` cache — the
   **same accessors dir mode uses, with no `isSingleFileMode` branch**.

**zustand here:** UI state only — `selectedLogFile` (route/selection), `loading`,
grid state. **Not `logDir`** — it lives in the react-query cache now, same as dir
mode — and not content.

---

## The three backends (deployments)

### Live server — `viewServerApi`

- **Selected when:** default (no other signal), or `?inspect_server=true`.
- **Loader: replicator** (directory). It reconciles against the running
  `inspect view` server. View-server is always directory mode — single-file deep
  links against the live server are no longer supported.

### Static bundle / hosted static — `staticHttpApi`

- **Selected when:** a `#log_dir_context` element is injected (a **static
  bundle**), or `?log_dir=` / `?log_file=` params — with no live server. Serves
  logs from static files; enumerates a directory via a **manifest**.
- **Loader: forks.**
    - `?log_dir=`, or a `#log_dir_context`-only bundle → **replicator** (directory),
      reconciling against the static manifest. **⇒ the new gate + `<ReplicationController>`
      path runs with no live server — the case worth verifying by hand.**
    - `?log_file=` → **direct load** (single-file) — that one param both selects
      static-http and trips single-file mode.

### VS Code — `vscodeApi`

- **Selected when:** running in the VS Code webview (`getVscodeApi()`).
- **Loader: forks** on whether the extension opened a log.
    - opened log → the extension injects a `#logview-state` element (which sets
      single-file mode); `App` feeds it through the same `onMessage` host bridge
      the live postMessage events use → **direct load**, replicator idle.
    - sidebar view with a `log_dir` and nothing selected → no `#logview-state`,
      so single-file mode is `false` → **replicator** (directory), resolving the
      dir via `vscodeApi.get_log_root`.

## The invariant that makes the replicator safe

Both `startReplication` call sites (`activateReplication`, and the defensive
re-activation inside `syncLogs`) **and** every content reader derive `logDir`
from the same gated `["log-dir"]` query. So the dir replication writes under is
identical to the dir the views key on (`get_log_root().log_dir`) — under _any_
backend. The bug this replaced was exactly the divergence: zustand `logs.logDir`
set asynchronously by scattered `initLogDir()` calls, racing render, producing a
transient empty `["logs-content", ""]` cache key.

Single-file shares this now too: its `logDir` is seeded into the _same_
`["log-dir"]` cache (by `setLogDir` / `initLogDir`), so the accessors
(`useLogDir` / `getLogDir`) have **no `isSingleFileMode` fork** — both modes read
one source.
