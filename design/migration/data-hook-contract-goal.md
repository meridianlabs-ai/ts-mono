# Goal: data hooks own freshness — retire side-effect kick-offs, split state/ vs log_data

## Intent (north star)
The general contract of a data hook: **call it, get data, and the data stays
current** (triggering rerenders). How the data is obtained and kept fresh —
polling, streaming, invalidation, cache seeding — is the *implementing layer's
private concern*. The smell this goal removes, in all its costumes: **high-layer
code imperatively kicking off lower-layer work** — a void `*SideEffect` hook, a
data hook mounted with its result discarded (keep-alive), or an exported action
called from a lifecycle effect (`useEffect(() => void loadLogs())`,
mount/cleanup brackets around `syncLogs`/`deactivateReplication`). Same smell,
one fix: the consumer subscribes to data; the data layer makes it fresh.

Above log_data, exactly **two imperative verbs survive**: *invalidate* (user/
event handlers requesting freshness, e.g. `refreshLog`) and *initialize*
(composition roots). Everything else is declarative subscription.

The layer split that realizes this:

- **log_data** owns param-driven data hooks — keyed on explicit
  `(logDir, logFile, …)` arguments, selection-ignorant — and *all* the freshness
  mechanism behind them (poll cadence, enablement mechanics, etag threading,
  engine production).
- **state/** owns thin *selection-binding* hooks: read the UI selection from
  zustand, delegate to the param-driven log_data hook. No polling mechanics, no
  API calls, no cache writes.

This revises `domain-ownership.md`'s sorting rule. Today: "polling lives in the
selected-log lifecycle, not acquisition." New sorting: **freshness mechanism is
acquisition interior; only selection-awareness stays outside.** The deeper rule
is unchanged — acquisition never reads selection — because the log_data hooks
take explicit params and state/ binds them. Two documented warts die as a
by-product: the `get_log_pending_samples` "lone exception" (the queryFn moves
inside acquisition, making "only acquisition talks to the backend about log
data" true without exceptions), and the `mergeDetails`/`resolveSample`
test-only barrel exports (the tests move in-dir with the code they test).

As with prior goals, success is measured by reduction: the clientEvents
singleton and the keep-alive mounts are deleted, not relocated.

## Scope
IN:
- **Pending samples → log_data.** The poll query (`fetchPendingSamples`, key,
  enablement, interval, etag) moves from `state/pendingSamples.ts` into a
  log_data module as `usePendingSamples(logDir, logFile)` (+ non-React
  `getPendingSamples`). state/ keeps a `useSelectedPendingSamples()` binding.
  `LogLoadController`'s discard-the-result keep-alive mount
  (`LogLoadController.tsx:28`) is deleted — freshness is subscriber-driven;
  every dependent (UI readers *and* the running-sample tick) declares its own
  dependency.
- **Sample queries → log_data.** `state/sampleQuery.ts` and
  `state/runningSampleQuery.ts` move into log_data as param-driven hooks
  (`useSample(handle)`, `useRunningSample(handle)`); state/ keeps the
  selection bindings feeding `useEvalSampleData`. The running-sample tick's
  ambient reads (`getLogDetail`, `getPendingSamples` —
  `runningSampleQuery.ts:105,117`) become in-subsystem reads of acquisition's
  own collections; its test moves in-dir and seeds `logsContent` directly, so
  `mergeDetails` leaves the barrel. `synthesizeErroredSampleFromSummary`
  travels with `fetchSample` as data normalization (the `resolveSample`
  precedent), retiring that test-only export too.
- **Listing sync fully subscriber-driven.** `useLogsSync` is already the good
  shape (LogsPanel/SamplesPanel subscribe); make it the *only* path:
  - `ReplicationController`'s mount/cleanup bracket (`LoaderHost.tsx:40` —
    `syncLogs(logDir)` on mount, `deactivateReplication()` on cleanup) is
    deleted; activation happens on demand inside acquisition (ensure inside
    `syncLogs`/`fetch`, old-dir teardown when the dir changes), so
    `ensureFetchEngine`/`deactivateReplication` leave the barrel (the
    `selectedLogDetails.ts:43` queryFn ensure goes too).
  - `FlowPanel.tsx:24`'s `useEffect(() => void loadLogs(), [flowDir])` becomes
    a `useLogsSync` subscription; the `loadLogs` action (`actions.ts:50`) is
    deleted.
  - `App.tsx:153`'s host-message `void syncLogs()` becomes invalidation of the
    listing query (an external freshness *event*, same family as
    clientEvents).
- **clientEvents → dissolved into log_data.** `state/clientEventsService.ts`
  (imperative singleton, `startPolling`/`stopPolling` driven by
  `LogsPanel.tsx:98` / `SamplesPanel.tsx:116` effects) is deleted. Its two
  behaviors — refresh-on-`refresh-evals` event, periodic listing refresh —
  become listing-freshness policy inside log_data (a poll keyed alongside
  `useLogsSync`, invalidating/re-running `syncLogs`). Panels just call
  `useLogsSync`; no imperative lifecycle.
- **`useLoadLogSideEffect` → routing controller.** Route→selection sync is not
  a view concern; move the mount out of `SampleDetailView.tsx:32` to the
  routing/loader layer (beside `LogLoadController`), named as a controller,
  not a `*SideEffect` hook.
- **`useThemePreferenceSyncSideEffect` → controller.** Not data; reframe the
  App.tsx-local hook as a render-null controller at the composition root (the
  sanctioned home for irreducible effects). Behavior unchanged.
- **`domain-ownership.md` updated**: new sorting rule; Boundaries section loses
  the pending-samples exception; Rules section loses the test-only-export
  exceptions; selected-log lifecycle entries become the binding hooks;
  controllers section reflects the diet.

OUT (unchanged / future):
- `LogLoadController`/`SampleLoadController` zustand reset reactions — doc-
  sanctioned non-derivable side effects; they stay (smaller).
- `state/selectedLogDetails.ts` — already a data-returning selection-keyed
  query over the acquisition surface; conforms as-is.
- Deriving selection *from the route* (deleting the route→zustand sync
  entirely — `useLoadLogSideEffect`'s effect, `SelectUrlLogFile`, App.tsx
  `onMessage` selection) — routing rework, separate goal. Here the syncs only
  get controller homes/names; selection stays imperative UI-state mutation.
- eslint import-path enforcement of the layering.

## Done when (all must hold)
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`, and
  `pnpm exec playwright test --config playwright.config.ts top-level-views.spec.ts`
  all green (from `apps/inspect`).
- Structural invariants (greppable, scoped to `apps/inspect/src`):
  - `rg -i "sideeffect" src` is empty.
  - `get_log_pending_samples` and `client_events` are called only from
    `log_data/` (api definitions in `client/` don't count).
  - `rg "startPolling|stopPolling" src` is empty; `clientEventsService.ts` and
    `state/pendingSamples.ts` / `state/runningSampleQuery.ts` /
    `state/sampleQuery.ts` are deleted or reduced to selection bindings with
    no queryFn/interval mechanics (`rg "refetchInterval" src/state` is empty).
  - `syncLogs`, `ensureFetchEngine`, and `deactivateReplication` are imported
    nowhere outside `log_data/`; `loadLogs` no longer exists; no `useEffect`
    exists whose body only kicks off acquisition work.
  - `mergeDetails` and `resolveSample` are not exported from
    `log_data/index.ts`; no test outside `log_data/` imports them.
  - No call site discards a data hook's return value to keep it warm
    (`usePendingSamples()` bare-statement mounts gone).
  - state/ binding hooks import no `api.*` and write no query cache entries.
- **Unit tests**: moved framework-free cores keep their table-driven tests
  (enablement, interval, response transitions, etag); running-sample tick
  tests live in `log_data/` seeding `logsContent` directly; binding hooks get
  thin wiring tests (seed selection, spy the delegate).
- Behavior parity vs the current branch: pending rows/metrics tick while an
  eval runs and stop with a final refresh on completion; running-sample
  streaming, finalize handoff (no loading flash), and errored-sample synthesis
  unchanged; listing refreshes on `refresh-evals` events and periodically
  while a panel is mounted; theme picker + cross-tab sync unchanged. Note any
  timing shifts.
- Net-subtractive outside log_data + tests (deletions ≥ insertions in state/
  and components). Self-assess; surface if unsure.

## Decision rubric (decide yourself — see Autonomy)
- **Params over ambient**: a log_data hook's inputs arrive as arguments (or
  in-subsystem cache reads); if a log_data module needs `useStore`, the split
  is wrong. Conversely a state/ binding that grows a `queryFn` has sunk too
  low.
- **Subscriber-driven freshness**: polling lifetime = subscriber lifetime.
  Verify each current reader mounts while it needs the data (LogView metrics,
  `useSampleSummaries`, running-sample tick) before deleting the keep-alive;
  if a genuine no-subscriber window exists, the dependent that needs the data
  declares it (e.g. the running-sample hook composes the pending-samples
  query) — never a third party keeping it warm.
- **Enablement is a derivation**, never imperative start/stop (the
  clientEvents replacement included: derive from panel-mounted query
  subscription, not `useEffect` brackets).
- **Two imperative verbs above log_data**: event handlers *invalidate*
  (`refreshLog`, a `refreshLogListing()` counterpart for the listing);
  composition roots *initialize*. A lifecycle effect calling an action to make
  data appear is the smell — replace it with a keyed query subscription.
- **Activation lifecycle is acquisition-internal**: ensure-on-demand keyed on
  `logDir` (an ensure for a new dir tears down the old one — the keyed-remount
  semantics of `ReplicationController`, moved inside `replicationControl`).
  App-teardown cleanup, if needed, is a composition-root concern.
- **Non-React reads** stay `getX()` accessors over the query cache, exported
  from the barrel only when a consumer outside log_data needs them.
- **Naming**: `useX(params)` in log_data; `useSelectedX()` bindings in state/;
  controllers are `<XController/>` render-null components.
- **Types**: no `any`/type assertions in `src` (tests may cast mocks).
- **Code health**: delete dead code, don't move it; no compat shims.
- **Comments**: WHY not WHAT; docstrings on public APIs only.

## Guardrails (must not break)
- Behavior parity per Done-when; when a change shifts poll timing or refresh
  cadence, note it.
- Commit in the **ts-mono submodule** only; never touch the submodule gitlink
  or the parent `inspect_ai` repo. **Always ask before pushing.** Commit per
  phase; never commit red.
- Don't disable static-analysis warnings without discussing.

## Autonomy contract (HIGH)
- Proceed without asking on anything the rubric covers — module naming/
  placement, query composition shape, test relocation, phase sequencing.
- Surface only: (a) a genuine fork the rubric doesn't resolve, (b) a real
  behavior/parity risk, (c) scope creep, (d) before pushing.
- Suggested phases (each independently green + committed): 1) pending samples
  → log_data + bindings, keep-alive deleted; 2) sample + running-sample
  queries → log_data, test-only exports retired; 3) listing sync
  subscriber-driven (ReplicationController bracket, FlowPanel effect,
  `loadLogs`, host-message invalidation, ensure/deactivate internalized);
  4) clientEvents dissolved; 5) the two `*SideEffect` hooks → controllers;
  6) `domain-ownership.md`.

## Current state (branch `loglist-tanstack-phase1`, ts-mono submodule)
- Precedent already landed: `useFlowQuery` replaced `useFlowServerDataSideEffect`
  (`37ea7588`) — the target shape in miniature.
- `pending-samples-query-goal.md` deliberately deferred the acquisition move
  and clientEvents; this goal is that deferral coming due.
- Inventory — hook-flavored: `useLoadLogSideEffect`
  (`state/useLoadLogSideEffect.ts:14`, mounted at `SampleDetailView.tsx:32`);
  `useThemePreferenceSyncSideEffect` (`App.tsx:77`); keep-alive mount
  (`LogLoadController.tsx:28`, commented "so polling never depends on which
  consumer tab is visible").
- Inventory — action-flavored (same smell): `ReplicationController` bracket
  (`LoaderHost.tsx:40`); `FlowPanel.tsx:24` effect → `loadLogs`
  (`actions.ts:50`); host-message `void syncLogs()` (`App.tsx:153`);
  `ensureFetchEngine` in a state queryFn (`selectedLogDetails.ts:43`);
  imperative clientEvents lifecycle (`LogsPanel.tsx:98`,
  `SamplesPanel.tsx:116`, singleton `state/clientEventsService.ts`).
- Ambient reads in the running-sample tick
  (`state/runningSampleQuery.ts:105,117`) force the `mergeDetails` barrel
  export (`log_data/index.ts:12`), documented as an exception in
  `domain-ownership.md`.
