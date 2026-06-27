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

| Backend ↓ \ Single-file Mode → | `false` | `true` |
|---|---|---|
| `viewServerApi` | default (`inspect view`) | `?task_file=` |
| `staticHttpApi` | `?log_dir=` · `#log_dir_context` bundle | `?log_file=` |
| `vscodeApi` | N/A ¹ | `#logview-state` (VS Code embed) |

> ¹ Structurally reachable (vscode backend with no `#logview-state`), but the
extension always embeds a single log, so directory + VS Code isn't a real combo.
> 
> **Likely-intended mutual exclusivity (not enforced).** The three URL params look
> meant to be mutually exclusive: `?log_dir=` selects a **directory** (directory
> mode), while `?log_file=` and `?task_file=` each name a **single file**
> (single-file mode) — two spellings of the same intent. But nothing guards
> against passing more than one. The backend and the mode are read from separate
> signal sets, so a contradictory combo doesn't error — precedence silently picks
> a winner, and the two decisions can even key off different params (e.g.
> `?task_file=` + `?log_dir=` → static backend from `log_dir`, single-file mode
> from `task_file`).
>
> **TODO: confirm this stuff with Charles.**

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

1. **(react)** `<AppLayout />` `isSingleFileMode` false branch → `<DirModeContent>`.
2. **(react-query)** `<DirModeContent>` calls `useLogRootAsync()` — the gated
   `["log-dir"]` query (`api.get_log_root()`, `staleTime: Infinity`) — and renders
   a loading state until it resolves.
3. **(react)** Resolved → `logDir = root.log_dir` →
   `<ReplicationController key={logDir} logDir={logDir} />` + `<Outlet/>`.
4. **(react → zustand)** `<ReplicationController>`'s mount effect calls
   `activateReplication(logDir)`; cleanup calls `deactivateReplication()`.
   `key={logDir}` makes a dir change a remount (clean stop → start).
5. **(zustand → module)** `activateReplication` opens the per-dir IndexedDB, then
   `replicationService.startReplication(db, api, replicationContext(logDir))`,
   then `sync(true)` — both pushing into the content cache via
   `logsContent.*(logDir, …)`, the `logDir` captured here being the gated value.
6. **(react / react-query)** Collection views read with
   `useLogDetails(useLogDir())` etc.; `useLogDir()` returns the *same* gated
   `log_dir`, so the key the views read matches what replication wrote.
7. **(zustand)** Re-syncs call `syncLogs()`, which sources the dir from
   `getLogDir()` (the cached query value, non-React) and re-activates defensively
   if not already running.

**zustand here:** UI state only — `loading`/`syncing`, `dbStats`,
`selectedLogFile`, grid state. Not `logDir`, not content.

### Direct loader

One specific log, no directory, no background work. The single-log slice
(`logSlice`) loads the open log on demand into the **same** content cache; `App`
seeds the lone handle for the `?task_file=` path via `logsContent.setLogHandles`.
No work queues, no directory-wide IndexedDB hydration, no polling — the
`ReplicationService` is **never started**. (Direct load ≠ no content: the open
log still reaches the cache; what's absent is the background, directory-wide
replication.)

Startup wiring:

1. **(react)** `<App>` → `<AppConfigGate>` → `<AppContent>` → `<RouterProvider>`.
2. **(react)** `AppLayout` reads `isSingleFileMode === true` → renders
   `<LogViewContainer>` / `<LogSampleDetailView>` **directly**. No
   `<DirModeContent>`, no gate, no `<Outlet/>`, **no `<ReplicationController>`**.
3. **(react-query — disabled)** The `["log-dir"]` query has
   `enabled: !isSingleFileMode`, so `get_log_root` is never fetched.
4. **(react → zustand)** Route components set `selectedLogFile` from the URL and
   call `initLogDir()` guarded by `if (isSingleFileMode)`; its single-file branch
   derives `logDir` from `selectedLogFile` (`deriveSingleFileLogDir`, falling back
   to `api.get_log_dir()`) and stores it in **zustand** `logs.logDir`.
5. **(module — idle)** The `ReplicationService` **never starts**: no controller,
   and `syncLogs()` bails immediately on `isSingleFileMode`.
6. **(react-query)** The open log's content is loaded on demand by the single-log
   slice (`logSlice`), keyed by `getLogDir()`.
7. **(react)** `useLogDir()` / `getLogDir()` return the **zustand** `logs.logDir`
   value via their `isSingleFileMode` branch.

**zustand here:** UI state **+ `logDir`** (route-derived with an async fallback
that suits the imperative flow; the gated query is disabled).

---

## The three backends (deployments)

### Live server — `viewServerApi`

- **Selected when:** default (no other signal), or `?inspect_server=true`.
- **Loader: forks.**
  - default (no file param) → **replicator** (directory). It reconciles against
    the running `inspect view` server.
  - `?task_file=` → **direct load** (single-file): a deep-link to one log served
    by the live server. `task_file` trips single-file mode but isn't a backend
    selector, so the backend stays the default view-server.

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
- **Loader: direct load** (single-file). The extension injects a `#logview-state`
  element for the opened log (which is what sets single-file mode); `App` feeds it
  through the same `onMessage` host bridge the live postMessage events use. The
  replicator stays idle. (VS Code ≡ single-file mode.)

## The invariant that makes the replicator safe

Both `startReplication` call sites (`activateReplication`, and the defensive
re-activation inside `syncLogs`) **and** every content reader derive `logDir`
from the same gated `["log-dir"]` query. So the dir replication writes under is
identical to the dir the views key on (`get_log_root().log_dir`) — under *any*
backend. The bug this replaced was exactly the divergence: zustand `logs.logDir`
set asynchronously by scattered `initLogDir()` calls, racing render, producing a
transient empty `["logs-content", ""]` cache key.
