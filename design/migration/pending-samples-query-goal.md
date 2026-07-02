# Goal: pending sample summaries out of zustand — a poll-driven react-query query

## Intent (north star)
`pendingSampleSummaries` (the running-eval sample-buffer summaries + running
metrics from `get_log_pending_samples`) is server data and lives in the
**react-query cache**, fetched by a **poll-driven query** keyed on the selected
log. The zustand leaf rule — *nothing writes into zustand from below, no
server-derived data in the store* — holds with **zero exceptions** for log-level
data, closing the leak the prior goals left: `logPolling.ts:125` writes
`state.log.pendingSampleSummaries` from a module singleton holding raw
`setState` handles.

The polling *singleton dissolves into query configuration*: cadence is
`refetchInterval`, lifecycle is query enablement derived from the selected
log's live status, teardown is key-change eviction. As with prior goals,
success is measured by reduction — `logPolling.ts` and `logPollingInstance.ts`
are deleted, not relocated; the slice actions and controller start/stop/clear
calls go with them.

## Scope
IN:
- New query module (e.g. `state/pendingSamples.ts`): query keyed
  `(logDir, logFile)`; queryFn calls `api.get_log_pending_samples(logFile,
  etag)` threading the previous data's etag; `NotModified` settles to the
  previous data. Framework-free decision core (enablement, interval,
  response→data transitions) as pure functions; the hook is thin glue.
- **Enablement is a derivation**, not an imperative start/stop: poll iff a log
  is selected, its live status is `"started"` (read from the details
  collection), and the api supports `get_log_pending_samples`. This subsumes
  both `LogLoadController` polling effects (start-on-load,
  restart-on-status-flip) and the completion semantics: status flipping off
  `"started"` stops polling; `NotFound` while still `"started"` keeps polling.
- Per-tick freshness preserved: each successful poll also produces
  `fetchEngine.fetch(logFile, "elevated")` — polling stays a producer into the
  acquisition surface (per domain-ownership), including the final refresh when
  the eval completes.
- Consumers repointed: `useSampleSummaries` merge (`state/hooks.ts`),
  `LogView` running metrics, and `samplePolling`'s `findLiveSummary` via a
  non-react accessor over the query cache (mirror the `logsContent` accessor
  pattern).
- Delete: `state/logPolling.ts`, `state/logPollingInstance.ts`
  (`setLogPollingApi`/`getLogPolling`/`cleanupLogPolling`), the
  `logSlice.pendingSampleSummaries` field +
  `setPendingSampleSummaries`/`clearPendingSampleSummaries` actions, the
  `LogLoadController` polling/clearing effects, and the store-cleanup wiring.
- Update `domain-ownership.md`: selected-log lifecycle polling entry and the
  Boundaries section reflect the new shape.
OUT (future goal):
- Sample-*detail* data — `samplePolling`, `runningEvents`, `selectedSample`,
  `useLoadSample`, sample status/error as `AsyncData`. Only `findLiveSummary`'s
  read is repointed here; samplePolling's own mechanics don't change.
- Moving `get_log_pending_samples` into the acquisition subsystem — the queryFn
  calls the api directly; the domain-ownership Boundaries exception narrows but
  remains for the call path.
- `clientEventsService` polling; the `utils/polling.ts` helper stays (other
  consumers).

## Done when (all must hold)
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`, and
  `pnpm exec playwright test --config playwright.config.ts top-level-views.spec.ts`
  all green (from `apps/inspect`).
- Structural invariants (greppable, scoped to `apps/inspect/src`):
  - `pendingSampleSummaries` appears in **no** zustand slice, store type, or
    action — `rg "pendingSampleSummaries" src/state/*Slice.ts src/app/types.ts`
    is empty; nothing writes log-level server data into the store.
  - `get_log_pending_samples` is called from **exactly one** module: the new
    query module (`client/` api definitions don't count).
  - `state/logPolling.ts` and `state/logPollingInstance.ts` are deleted; no
    `setLogPollingApi`; no module singleton holds store `setState` handles for
    log-level data.
  - The new query module imports no zustand write surface; selection reads
    happen in the hook layer.
- **Unit tests** for the framework-free core, table-driven: enablement × (log
  selected, live status, api capability); interval derivation (server `refresh`
  hint vs 2s default); response transitions (`OK` replaces data, `NotModified`
  keeps data, `NotFound`+running keeps polling, `NotFound`+not-running stops);
  etag threading. Thin hook-wiring tests (seed the cache / spy the core).
- Behavior parity vs the current branch: samples list grows and metrics tick
  while an eval runs; polling stops with a final refresh on completion; a
  just-started eval (`NotFound`, buffer not ready) keeps polling; deep-link to
  a running log polls; completed logs never poll; apis without
  `get_log_pending_samples` (static/embedded) stay inert. Note any timing
  shifts.
- Net-subtractive outside the new module + tests (deletions ≥ insertions in
  the orchestration layer). Self-assess; surface if unsure.

## Decision rubric (decide yourself — see Autonomy)
- **Reactive & functional first**: cadence, enablement, and teardown are
  derivations of `(selection, live status, api capability, server refresh
  hint)`; if you find yourself writing start/stop/clear calls, the design is
  wrong.
- **Observer lifetime**: polling must be live whenever a running log is open,
  regardless of which tab/panel is mounted. If consumer mounts don't guarantee
  that, put the observer in `LogLoadController` (the reaction controller) —
  don't rely on incidental component mounts.
- **Etag/NotModified**: thread the etag from previous query data; `NotModified`
  must not settle to `undefined` (react-query rejects it) — return the prior
  data; make sure unchanged polls don't churn referential identity
  (`useSampleSummaries` memo, `LogView` metrics).
- **Retry**: react-query's retry replaces `createPolling`'s
  `maxRetries: 10` — match "give up after repeated consecutive failures"
  approximately; don't build a bespoke retry layer.
- **Accessors/naming**: `useX()` hook; non-react read via a `getX()`-style
  accessor over the query cache; framework-free core as plain functions.
- **Types**: no `any`/type assertions in `src` (tests may cast mocks).
- **Code health**: delete dead code, don't move it; no compat shims.
- **Comments**: WHY not WHAT; docstrings on public APIs only.

## Guardrails (must not break)
- `samplePolling` behavior must not regress — its only touch is repointing
  `findLiveSummary`'s read.
- Commit in the **ts-mono submodule** only; never touch the submodule gitlink
  or the parent `inspect_ai` repo. **Always ask before pushing.** Never commit
  red.
- Don't disable static-analysis warnings without discussing.

## Autonomy contract (HIGH)
- Proceed without asking on anything the rubric/guardrails cover — module
  naming, observer placement, test shape, refetch mechanics.
- Surface only: (a) a genuine fork the rubric doesn't resolve, (b) a real
  behavior/parity risk, (c) scope creep, (d) before pushing.

## Current state (branch `loglist-tanstack-phase1`, ts-mono submodule)
- Prior goals complete ([reactive-refactor-goal.md](reactive-refactor-goal.md),
  [fetch-engine-goal.md](fetch-engine-goal.md)); this closes a leak against
  their done-when ("no server-derived data cached in zustand"; leaf rule "no
  exceptions" in [domain-ownership.md](domain-ownership.md)).
- The leak: `logPolling.ts:125` writes `state.log.pendingSampleSummaries` from
  the singleton; `logPolling.ts:138-140` also reads laterally via
  `getLogDir()` + `logsContent.getLogDetail` (dies with the module).
- Writers: `logSlice.ts:114-121` (set/clear actions),
  `LogLoadController.tsx:43-44,57-61` (clear + start effects).
- Readers: `state/hooks.ts:220` (`useSampleSummaries` merge),
  `LogView.tsx:43` (metrics), `samplePolling.ts:378` (`findLiveSummary`).
- Polling mechanics to reproduce: interval = server `refresh` hint else 2s;
  10-retry give-up; etag pass-through; per-tick
  `fetchEngine.fetch(logFile, "elevated")`.
