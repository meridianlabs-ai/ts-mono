# Goal: viewer startup/data layer → reactive & encapsulated (zustand = UI state only)

## Intent (north star)
The inspect viewer's zustand store holds **only ephemeral UI state**. All
async/server-derived data lives in **react-query** (keyed reactively); all
IO/lifecycle (replication, single-log load, polling, DB, app config) lives in
**owned module singletons + React controllers**. Each domain concept has exactly
**one owner**. Imperative code exists only at **event handlers** and the **IO
boundary**; the middle is derivation, not orchestration.

Success is measured not just by *where* code lives but by *how much less* of it
there is. The primary lever is **reactive & functional over distributed
imperative**: prefer derivation and pure transforms; treat deleting orchestration
as the win, not a risk. One-owner gives localization; this gives the reduction —
they're both required.

## Scope
IN: finish getting IO/config/data out of zustand **and** the reactive follow-ups
that don't require re-architecting data loading — unify
`activateReplication`/`syncLogs` into one owner; collapse the startup gate /
delete `PushedQuerySource` (verify the always-present-embedded assumption first).
OUT (separate future goal): server-side filter/sort (`getLogsListing` queryFn swap
+ deleting the client listing evaluator); the `ScoreAgGrid` / AG-Grid removal.
Also deferred:
- **Proper `AsyncData`-derived `loading`** — the imperative `setLoading` brackets
  are already removed and the loading UI is dormant (kept, uncalled). The proper
  reactive reimplementation is coupled to making the imperative loads (streaming
  replicator dir sync, single-log details load) into react-query queries (the
  loads-as-queries / server-side direction); reimplement the loading UI then.
- A later "harden the boundaries" pass: formalizing layering as eslint
  import-paths, and mechanically pushing replication *status* (`syncing`/
  `dbStats`) off zustand. This goal leans toward those (see rubric) but doesn't
  gate on them.

## Done when (all must hold)
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`, and
  `pnpm exec playwright test --config playwright.config.ts top-level-views.spec.ts`
  are all green (from `apps/inspect`).
- Structural invariants (greppable):
  - `apps/inspect/src/state/*Slice.ts` do **no** network/DB/replication IO — no
    `getAppConfig`, `getDatabaseService`, `replicationService`, `logsContent.*`,
    or `api.(get_|open_|download)` calls in the slices.
  - No server-derived data cached in zustand state (no handles/previews/details/
    evalSet/logDir fields on the store) — it's all react-query.
  - No imperative `setLoading(true/false)` brackets in data-load paths — the
    loading UI is kept but dormant (never called); `rg "setLoading\((true|false)\)"
    src` is empty. Proper `AsyncData`-derived loading is a follow-up.
  - One owner per concept; **no dead code, no duplicated orchestration**
    (`activateReplication`/`syncLogs` unified; single startup gate).
- **Every allowed startup permutation works and is tested** — the valid
  combinations of `{ backend } × { single-file mode } × { invocation }`, per the
  matrix in `replication-startup-modes.md` (backend selection + single-file
  detection + loader + logDir resolution correct in each):
  - `viewServerApi` — **dir only** (default / `?inspect_server=true`)
  - `staticHttpApi` — **dir** (`?log_dir=` / `#log_dir_context` bundle) **and
    single-file** (`?log_file=`)
  - `vscodeApi` — **dir** (sidebar `log_dir`, no `#logview-state`) **and
    single-file** (`#logview-state` embed)
  Also covered: the contradictory `?log_dir=` + `?log_file=` invocation throws;
  view-server + single-file is never produced (single-file signals route to
  static-http). Coverage is unit (`resolveBootstrap`/`resolveApi` +
  `loadResolvedAppConfig`) with e2e for the primary cells.
- **Materially less distributed/imperative code.** Side-effects live only at the
  three seams (event handlers, service/IO modules, React controllers); the data +
  derivation middle is pure/reactive. Observable proxies: the change is
  net-subtractive in the orchestration layer (deletions ≥ insertions there); no
  `useEffect` that `setState`s to trigger another `useEffect` (no
  reactive-costume cascades); no `action → action → service` call chains left in
  the store. (Judged at review, not by a command — self-assess under the autonomy
  contract; surface if unsure.)
- Behavior parity vs `origin/main` preserved (see Guardrails).

## Decision rubric (decide these yourself — see Autonomy)
- **Reactive & functional first (the primary lever)**: derive, don't
  store-and-sync; pure functions over imperative sequences; declarative
  keyed-controller lifecycle over imperative start/stop calls; quarantine
  side-effects to the three seams. When two designs both work, pick the one with
  the smaller imperative surface — and prefer the one that lets you *delete* code.
- **Layering (a lean, not a gate — yet)**: the non-react module layer (services /
  control / appConfig) and the zustand store want to be **mutually isolated** —
  communicating through react-query rather than by importing each other, with
  zustand holding only state nothing below cares about. Treat this as a strong
  steering preference and use judgment; don't contort code to satisfy it. A later
  pass will formalize the boundaries (eslint import-paths) once the shape has
  settled — and settle open questions like whether react-query is the *sole*
  upward medium and where `urlLogSource` belongs.
- **Layering**: zustand = ephemeral UI state; react-query = async/server data
  (reactively keyed); `xInstance.ts` module singletons = services (DB /
  replication / polling); React controllers = lifecycle effects keyed on reactive
  state.
- **Accessors/naming**: `useX()` react hook; `getX()` sync non-react (asserts) /
  `peekX()` non-asserting; framework-free cores as plain functions, hooks are thin
  glue; service singletons via a `setXApi`/`getX` init seam (mirror
  `samplePollingInstance`).
- **Types**: flat public types; no impl detail on public shapes; **no `any`/type
  assertions in `src`** (tests may cast mocks); normalize `undefined`↔`null` at
  the seam that needs it (e.g. react-query rejects `undefined`).
- **Code health**: **delete dead code, don't move it**; no backward-compat shims
  within this branch; one owner per concept.
- **Tests**: table-driven; exhaustively test the framework-free core (permute the
  real inputs, compute expected); thin hook-wiring tests (spy the core / seed the
  cache); add tests for every new module; keep the suite green each phase.
- **Comments**: WHY not WHAT; docstrings on public APIs only.

## Guardrails (must not break)
- **Parity vs `origin/main`** across: dir mode, `?log_file=`, `#logview-state`
  embed, deep-link, VS Code live-nav — replication **and** single-log load stay
  correctly (re)ensured. When a change shifts timing/behavior, note it.
- Before deleting `PushedQuerySource`, verify `#logview-state` is always present
  at startup in embedded mode across static / view-server / VS Code.
- Commit in the **ts-mono submodule**; never touch the submodule gitlink or the
  parent `inspect_ai` repo. **Always ask before pushing.** Commit per logical
  phase with a clear message; never commit red.

## Autonomy contract (HIGH)
- Proceed **without asking** on anything the rubric/guardrails cover — naming,
  placement, module-vs-hook, test shape, obvious refactors, phase sequencing.
- Surface to the user **only**: (a) a genuine fork the rubric doesn't resolve,
  (b) a real behavior/parity risk, (c) scope creep beyond this goal, (d) before
  pushing.
- Work phase by phase, verifying (Done-when gates) after each; commit per phase.

## Current state (already landed on `loglist-tanstack-phase1`, not pushed)
- `96428ce0` — startup unified into `AppConfig`; `syncLogs` out of zustand.
- `61b2b82c` — remaining log-sync/loader/polling/evalSet IO out of zustand; slices
  are UI-state-only (`getAppConfig` in `src/state` now only `logLoad.ts` +
  `replicationControl.ts`).
Remaining: the three reactive follow-ups in Scope IN.
