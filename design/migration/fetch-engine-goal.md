# Goal: one fetch engine — all backend log-data acquisition through a single prioritized contract

## Intent (north star)
All backend log-data fetching (details, previews) goes through **one
mode-independent fetch engine** whose public contract is
`fetch(logFile, priority): Promise<LogDetails>` — "get this data at the highest
priority" is an enqueue-or-bump on a shared queue, never a separate code path.
Replication, selection, refresh, and polling become *producers* of prioritized
work; react-query remains the medium consumers read. Loading/error become
derivations of `AsyncData`, never imperatively set. The target ownership map is
[domain-ownership-target.md](domain-ownership-target.md) (current state:
[domain-ownership.md](domain-ownership.md)); this goal implements it.

As with the prior goal, success is measured by *reduction*: four scattered
`get_log_details` call sites collapse to one; `loadLog`/`refreshSelectedLog`
imperative orchestration and the dormant loading-UI machinery are deleted, not
relocated.

## Scope
IN:
- Extract `state/fetchEngine.ts`: the two `WorkQueue`s + batched write paths
  hoisted out of `ReplicationService`; per-item completion promises; dedupe by
  in-flight promise sharing; priority bump on duplicate enqueue (WorkQueue has
  this); injected deps (`api`, `database`, cache **sink** = the `logsContent`
  write surface: `writeHandles`/`writePreviews`/`writeDetails`/`clearFile`/
  `clearAll`). Framework-free: no react-query/zustand imports.
- DB becomes **engine-private**: engine is sole DB reader/writer (read-through
  cache: DB hit → sink + background refresh decision, miss → fetch). Replication
  applies discovery via narrow engine methods (e.g.
  `applyListing({updated, deleted})`), not by touching DB/cache itself.
- Replication narrows to **discovery**: list dir, diff (new/changed/deleted),
  then produce into the engine at background priority. No queues, no fetching.
- Selected-log details become a **react-query query**
  (`queryFn: () => fetchEngine.fetch(logFile, "user")`); `loadLog`,
  `ensureSelectableLog`'s await-a-full-sync dance, and `refreshSelectedLog`
  dissolve (refresh = query invalidation). Post-load side effects that can't be
  derived (workspace-tab reset for empty logs, polling start/stop) live in one
  small controller reacting to the query's `AsyncData`; everything derivable is
  derived.
- Log polling becomes a **producer**: interval tick enqueues the running log at
  elevated priority; no direct `get_log_details` calls.
- Engine status (`syncing`/`dbStats`/progress) exposed via an engine-owned
  external store + `useFetchEngineStatus()` (`useSyncExternalStore`); the
  `replicationContext` → zustand status writes and the zustand
  `dbStats`/`syncing`/loading-status fields are **deleted**. Proper
  `AsyncData`-derived loading replaces the dormant loading UI (this closes the
  deferred item from the prior goal).
OUT (future goals):
- Sample-level data (samplePolling, sample loading) — engine contract must not
  preclude a later sample queue, but don't build it now.
- Server-side filter/sort (`getLogsListing` queryFn swap); AG-Grid removal.
- Engine-owned `watch(logFile)` freshness policy (polling stays a producer).

## Done when (all must hold)
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`, and
  `pnpm exec playwright test --config playwright.config.ts top-level-views.spec.ts`
  all green (from `apps/inspect`).
- Structural invariants (greppable, scoped to `apps/inspect/src`):
  - `api.get_log_details` is called from **exactly one** module:
    `state/fetchEngine.ts` (client api implementations in `client/` define it;
    they don't count).
  - `WorkQueue` is imported only by `fetchEngine.ts`.
  - `getDatabaseService` (or the DB service) is consumed only by the engine +
    the composition-root init/cleanup.
  - `fetchEngine.ts` imports neither react-query nor zustand (sink + status
    store are the only outward channels).
  - `state/logLoad.ts` is deleted; no `refreshSelectedLog`-style imperative
    refresh (refresh is query invalidation).
  - No `setLoading` calls anywhere; the `appSlice` loading-status machinery is
    deleted; loading/error in the log-open path derive from `AsyncData`.
  - Zustand holds no `dbStats`/`syncing` fields; `logSlice.pollLog` is gone;
    the prior goal's slice invariants still hold (slices do no IO, no config
    reads, no server-derived data in the store).
- **Engine unit tests with fakes** (fake api/db/sink, no jsdom): priority
  ordering, duplicate-enqueue priority bump, in-flight dedupe (one fetch, both
  callers' promises resolve), user-priority front-running queued background
  work, single-file mode (engine alive with no replication producer),
  read-through cache behavior.
- **Every allowed startup permutation still works** — the
  `{ backend } × { single-file } × { invocation }` matrix from
  `replication-startup-modes.md` stays green (unit + the e2e above), including:
  single-file mode loads the log's details through the engine with no
  replication running; dir mode replicates and a selected log's details arrive
  ahead of background work.
- **Materially less code in the orchestration layer** (deletions ≥ insertions
  outside the new engine + its tests): `loadLog`/`refreshSelectedLog`/loading
  machinery deleted; no `action → action → service` chains; no
  effect-cascades. Self-assess; surface if unsure.
- Behavior parity vs current `goal-driven` across: dir mode, `?log_file=`,
  `#logview-state` embed, deep-link, VS Code live-nav, running-log polling,
  toolbar refresh. When a change shifts timing/behavior, note it.

## Decision rubric (decide yourself — see Autonomy)
- **Reactive & functional first**: derive, don't store-and-sync; when two
  designs work, pick the smaller imperative surface, prefer the one that
  deletes code.
- **One fetch path**: any temptation to fetch outside the engine is a design
  error — add a priority level or an engine method instead.
- **Layering**: engine = L2 service, dependency-injected at the composition
  root (mirror `setXApi` seams); producers call engine methods; consumers read
  queries/hooks; zustand = UI leaf with **zero** exceptions after this goal.
- **Accessors/naming**: `useX()` hooks; `getX()` sync non-react asserting /
  `peekX()` non-asserting; framework-free cores as plain functions.
- **Types**: no `any`/type assertions in `src` (tests may cast mocks);
  normalize `undefined`↔`null` at the seam that needs it (react-query rejects
  `undefined` queryFn results — coalesce to `null` in the queryFn, `select`
  back).
- **Code health**: delete dead code, don't move it; no compat shims within the
  branch (parity target is behavior, not code shape).
- **Tests**: table-driven; exhaustively test the framework-free engine core
  with fakes; thin hook-wiring tests; keep the suite green each phase.
- **Comments**: WHY not WHAT; docstrings on public APIs only.

## Suggested phasing (adjust as discovered)
1. Extract `fetchEngine` (queues + write paths + promises + status store) with
   behavior parity; replication repointed as producer; engine unit tests.
2. Selection-as-query: details query on `fetch(logFile, "user")`; dissolve
   `logLoad`/`refreshSelectedLog`; slim `LogLoadController` to the reaction
   controller; refresh = invalidation.
3. Polling as producer.
4. Reactive status + delete loading machinery and zustand status fields;
   `AsyncData`-derived loading UI.
Commit per phase; never commit red.

## Guardrails (must not break)
- Parity per Done-when; verify the VS Code embed path by construction (no
  local run) and call out that it needs a manual check.
- Commit in the **ts-mono submodule** only; never touch the submodule gitlink
  or the parent `inspect_ai` repo. **Always ask before pushing.**
- Don't disable static-analysis warnings without discussing.

## Autonomy contract (HIGH)
- Proceed without asking on anything the rubric/guardrails cover — naming,
  placement, test shape, phase order, obvious refactors.
- Surface only: (a) a genuine fork the rubric doesn't resolve, (b) a real
  behavior/parity risk, (c) scope creep, (d) before pushing.

## Current state (branch `goal-driven`, ts-mono submodule, not pushed)
- Prior goal complete ([reactive-refactor-goal.md](reactive-refactor-goal.md)):
  config unified in AppConfig (`useAppConfig`/`useApi`), slices UI-only, IO in
  module singletons + controllers, loading UI dormant.
- Latest commits: `343e99f2` (useApi passthrough), `6c1427cf` (config reads via
  useAppConfig; `useSelectLogFile`), `e570fbb4` (loading UI dormant).
- Known starting points: 4 `get_log_details` call sites
  (`replicationService` detail queue, `logLoad.loadLog`,
  `logLoad.refreshSelectedLog`, `logPolling.ts:45`); queues private to
  `ReplicationService` (`_previewQueue`/`_detailQueue`, batched flushes);
  `WorkQueue` already supports priority bump + `processImmediate`;
  `ensureSelectableLog` awaits a full `syncLogs()` to discover unknown files.
