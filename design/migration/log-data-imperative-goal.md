# Goal: shrink the imperative log_data surface — commands stay, plumbing dies

## Intent (north star)

`imperativeLogData` should hold only **irreducible commands** — verbs a user
or external event genuinely issues — never plumbing that exists because a
mechanism lives on the wrong side of the boundary. Today's four verbs, audited:

- `fetchLog` — exists only because the selected-log *query* lives in `state/`,
  so state needs a queryFn, so log_data must export a fetch. The rubric's own
  smell ("a state binding growing a queryFn has sunk too low").
- `init(api)` — self-feeding: main.tsx reads `getApi()` *from app_config* and
  passes it back down (`initializeStore` → `init` → `injectedApi`), while
  `useLogsSync.ts` already calls `getApi()` directly inside log_data. Two
  sources of truth for one dependency, one of them ceremony.
- `invalidateLogListing` — a legitimate *invalidate* verb (host `backgroundUpdate`
  message), though the same domain event ("listing may be stale") also arrives
  by a second transport handled interiorly (`client_events` poll). Stays, for
  now (see OUT).
- `clearData` — a user command. Correctly imperative. Stays.

Same audit interiorly: **"replication" names three different concerns**, and
`ReplicationService` duplicates machinery react-query and `replicationControl`
already own:

| Concern | Today | Target |
|---|---|---|
| Activation/composition (engine+db per dir, teardown on dir change) | `replicationControl.ts` | unchanged — the one lifecycle owner |
| Discovery (server-listing diff) | `ReplicationService` class | pure `syncListing()` function |
| Coalescing/freshness scheduling | hand-rolled `_pendingSync`/`_syncQueued` queue | react-query (keys + invalidation) |
| Content acquisition (fetch, persist, prioritize) | `FetchEngine` | unchanged — the one stateful machine |

`ReplicationService`'s `startReplication`/`stopReplication`/`isReplicating`
is DI plus a boolean paralleling activation state `replicationControl`
already tracks (`engineDir`, `pendingActivation`, `fetchEngine.isStarted()`).
Its coalescing queue exists only because `clientEventsTick` calls `syncLogs()`
directly instead of invalidating the sync query.

Target imperative surface:

```
imperativeLogData = {
  invalidateLogDetail,  // user refresh / edit-save — the log-detail invalidate verb
  invalidateLogListing, // external freshness event (until host events normalize)
  clearData,            // user maintenance command
}
```

Success is measured by reduction: `fetchLog` and `init` leave the interface;
the `ReplicationService` class, its lifecycle triple, its queue, and
`injectedApi`/`requireApi` are deleted, not relocated.

## Scope

IN:

- **`ReplicationService` → pure function.** The diff algorithm (list server →
  diff against `engine.listing()` → `engine.applyListing()`) becomes a
  stateless `syncListing(api, engine)` in log_data; the class, singleton, and
  `startReplication`/`stopReplication`/`isReplicating` die. Activation truth
  lives solely in `replicationControl` (which already decides "needs
  activation" without asking the service anything it couldn't know itself).
- **Tick invalidates, never calls.** `clientEventsTick` stops calling
  `syncLogs()` directly; it invalidates the logs-sync query for its `logDir`
  (the tick only runs while a `useLogsSync` subscriber is mounted, so the
  refetch is guaranteed). Coalescing of concurrent freshness requests becomes
  react-query's per-key dedupe.
- **Selected-log query → log_data.** The query + key + `staleTime`/`retry`
  posture in `state/selectedLogDetails.ts` move into log_data as
  `useLogDetailQuery(logDir, logFile): AsyncData<LogDetails>`;
  `invalidateSelectedLog` becomes log_data's `invalidateLogDetail(logDir,
  logFile)` (called by `refreshLog` in `state/actions.ts`). state/ keeps
  `useSelectedLogQuery`/`useSelectedLogLoading` as selection bindings.
  `fetchLog` leaves `ImperativeLogData` (interior only). This is a
  *relocation*, not the details-read unification (OUT): query identity —
  which `LogLoadController` keys off as its "fetch settled" event — is
  unchanged by changing the query's home.
  *(Since superseded: the unification landed — `useLogDetailQuery` was
  absorbed into the tri-state `useLogDetail`, and `LogLoadController` keys
  off `details_settled_seq`. See `log-data-unified-fetch-plan.md`.)*
- **One api source.** log_data reads `getApi()` from app_config everywhere
  (it already does in `useLogsSync.ts`); `injectedApi`/`requireApi` die.
- **`init` diet.** With the api param gone, `init`'s only job is
  `initDatabaseService()`. Make database-service creation lazy on first
  activation (`ensureFetchEngine`), keeping the injectable override as an
  explicit test seam; `init` leaves the interface. If laziness proves too
  magic (ordering, test ergonomics), fallback: zero-arg `init()` called from
  **main.tsx** (the composition root), not from `initializeStore` — store
  init must not own log_data's lifecycle either way.
- **`domain-ownership.md` updated**: imperative surface list, interior table
  (discovery as a pure function; activation as sole lifecycle owner),
  awareness diagram, selected-log lifecycle entries.

OUT (future goals):

- **Host-event normalization.** `backgroundUpdate` postMessage (App.tsx) and
  the polled `refresh-evals` client event are two transports of one domain
  event; normalizing them into a client-layer stream log_data subscribes to
  would retire `invalidateLogListing` from the surface. Tangled with
  `onMessage`'s selection concerns — separate goal.
- **Details-read unification** (`useLogDetail` collection vs the relocated
  selected-log query vs `fetchLog` absorption; the TODO at
  `selectedLogDetails.ts:30`) — still blocked on a designed "fetch settled"
  event for `LogLoadController`.
- eslint enforcement of the barrel/layering.

## Behavior changes vs origin/main — discuss with Charles

**The selection principle** (what the change codifies): a sample is
*selected* when a grid highlights it OR its detail view is open — one
concept, `selectedSampleHandle`, owned by zustand, kept true by whichever
surface the user is driving. Selection is an **identity claim only**: it
never implies the sample's EvalSample is cache-resident (grid selection
must stay fetch-free). Surfaces that *decorate* selection (the invalidation
chip) therefore read passively (`usePassiveSampleData`) and treat absence as
a normal answer; only a detail view — which shows the sample — acquires it
(`useSampleData`).

Landed alongside this goal (commit `318e2192`, "controlled grid selection"),
accepted deliberately but **needs sign-off from Charles before the branch
merges**:

- **Grid keyboard selection now writes `selectedSampleHandle`.** On main,
  arrow keys move only AG-grid's internal selection
  (`gridKeyboardNavigation.ts` → `setSelected`; no `onSelectionChanged`
  handler) — zustand tracks the *last-opened* sample and the highlight may
  drift from it, so the title-bar invalidation chip can describe a different
  sample than the highlighted row. Now the highlight *is* the selection:
  `DataGrid` reports moves (`onSelectedRowChange`), `SampleList`/
  `SamplesPanel` write them via `selectSample`, and selection-keyed surfaces
  (invalidation chip, passive sample reads) follow the highlight —
  fetch-free.
- Rode along: `SamplesPanel`'s selected-row id derives from the handle's own
  `logFile` (main uses `selectedLogFile` — wrong for cross-log rows), and
  `SampleList`'s row-open guard is deleted (main skips re-opening the
  route-open sample via `isSampleOpenInRoute`; the branch had rewritten it
  selection-keyed, which under highlight-as-selection made the highlighted
  row unopenable). If a layout renders the list while a sample detail is
  open, main's route-keyed guard may be worth restoring.
- Alternative if the divergence is rejected: revert to main's grid-local
  highlight and instead bind the invalidation chip to the *open* sample
  (route-derived, not `selectedSampleHandle`) — fixes the stale-chip bug
  with no zustand semantics change.

**`?log_file=xxx` vs `#/tasks/xxx` — why do two URL forms for "open this
log" behave so differently?** (Pre-existing on main, not a branch change —
raised here because the difference is non-obvious and feels arbitrary.)
`?log_file=` is an *invocation-time* signal read once by `resolveApi`/
`resolveAppConfig` (`app_config/`): it selects **single-file mode** — bare
form resolves `staticHttpApi` (the app reads the `.eval` bytes relative to
the page origin; against a dev/view server this 404s unless
`&inspect_server=true` is added), no listing sync, no replication, no
per-dir IndexedDB, and therefore no next/prev-log navigation. `#/tasks/xxx`
is *navigation state* inside directory mode: full listing, replication,
persistence, next/prev all work. So the same log opened via the two forms
gets two different apps. The single-file semantics exist for genuinely
listing-less hosting (S3/static export; VS Code embeds inject
`#log_dir_context` instead) — but when the backend *can* list the directory
(view server), forcing single-file mode is arbitrary: the dir is derivable
from the file (`resolveAppConfig` already does this for the db handle).
Question for Charles: should `?log_file=` against a listing-capable server
just resolve to directory mode with the log selected (i.e., become a
deep-link alias for `#/tasks/xxx`), reserving single-file mode for truly
static hosting?

## Done when (all must hold)

- `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test` green (from
  `apps/inspect`).
- `ImperativeLogData` is exactly `{ invalidateLogDetail, invalidateLogListing,
  clearData }` (`invalidateLogDetail` passes the membership test — `refreshLog`
  is a user command).
- Structural invariants (greppable, scoped to `apps/inspect/src`):
  - `rg "startReplication|stopReplication|isReplicating|ReplicationService"`
    is empty.
  - `rg "injectedApi|requireApi|initLogData"` is empty.
  - `rg "fetchLog" src/state src/app` is empty; `syncLogs` is called only by
    the logs-sync queryFn (the tick invalidates).
  - `state/selectedLogDetails.ts` contains no queryFn/queryKey mechanics —
    selection bindings only (or the file is gone).
  - No log_data module holds a module-level api variable.
- **Unit tests**: `syncListing` keeps the diff coverage as a pure-function
  table (static list, incremental, full-response deletes); tick-invalidation
  gets a test (tick → sync query refetches); the relocated query keeps
  whatever coverage it has; wiring tests for the state bindings.
- Behavior parity vs the current branch: listing re-syncs on `refresh-evals`
  and periodic ticks; concurrent freshness requests coalesce (now via
  react-query) with no duplicate `applyListing` interleavings; selected-log
  fetch/loading/error surfaces unchanged; `LogLoadController`'s load/reset
  reactions fire exactly as before; deep-link first fetch still activates the
  engine on demand; clear-data still empties db + cache. Note timing shifts.
- Net-subtractive overall (the class, queue, lifecycle triple, api plumbing
  all die). Self-assess; surface if unsure.

## Decision rubric (decide yourself — see Autonomy)

- **Commands, not plumbing**: a verb stays on `ImperativeLogData` iff a human
  or external event issues it. A verb that exists so another layer can run a
  mechanism is a mis-homed mechanism.
- **One owner per concern**: activation state lives in `replicationControl`
  only; if a function needs to know "are we active", it asks the owner (or is
  called by it) — no second registry.
- **Coalescing belongs to react-query**: freshness requests rendezvous on
  query keys. Hand-rolled single-flight is admissible only if a real
  cross-key race survives (see unresolved: multi-scope sync), and then as a
  module-local promise share, never a class lifecycle.
- **Relocation before redesign**: the selected-log query moves as-is
  (posture, key shape, TODO comment included). Unifying it with the
  collection is the OUT goal.
- **Lazy init must be deterministic**: first-activation creation is fine only
  if every entry point (`syncLogs`, `fetchLog` interior, deep link) passes
  through it; if any path can observe a missing service that `init` used to
  guarantee, take the zero-arg-`init`-in-main.tsx fallback.
- **Types**: no `any`/type assertions in `src` (tests may cast).
- **Code health**: delete dead code, don't move it; no compat shims; comments
  say WHY not WHAT.

## Guardrails (must not break)

- Behavior parity per Done-when; note poll-cadence/coalescing timing shifts.
- Commit in the **ts-mono submodule**; parent repo gets gitlink bumps only.
  **Always ask before pushing.** Commit per phase; never commit red.
- Don't disable static-analysis warnings without discussing.

## Autonomy contract (HIGH)

- Proceed without asking on anything the rubric covers — module naming and
  placement, function signatures, test relocation, phase sequencing.
- Surface only: (a) a genuine fork the rubric doesn't resolve, (b) a real
  behavior/parity risk, (c) scope creep into the OUT list, (d) before
  pushing.
- Suggested phases (each independently green + committed):
  1) `ReplicationService` → pure `syncListing`; tick invalidates; queue and
     lifecycle deleted. Interior only — zero surface change.
  2) Selected-log query → log_data; `fetchLog` off the interface;
     `invalidateLogDetail` verb.
  3) api-sourcing unification + `init` diet; interface reaches target shape.
  4) `domain-ownership.md`.

## Unresolved questions

- OK that `invalidateLogListing` survives until host-event normalization?

Resolved during execution: `LogLoadController` depends only on the query
result's object identity (effect deps) — move-safe. Multi-scope: panels are
route-exclusive, but same-dir overlap survives via `invalidateQueries`'
cancel-refetch and scope transitions → module-local trailing-coalesce
single-flight in `syncLogs` (per rubric). `init`: fully lazy passes the
determinism test — every db-service read flows through `ensureFetchEngine`,
`getApi()` is bootstrap-safe, and the injection seam had no test consumers;
`init` deleted (`initializeStore` also loses its api param — unused once
log_data self-wires).

## Current state (branch `loglist-tanstack-phase1`, ts-mono submodule)

- Precedent: `imperativeLogData` formalized (interface + single const);
  data-hook-contract goal established the two-verbs rule (*invalidate* +
  *initialize*) and absorbed the old `ReplicationController` component into
  `replicationControl`.
- Inventory — consumers: `init` at `state/store.ts:128` (api threaded from
  main.tsx's own `getApi()` read); `fetchLog` at
  `state/selectedLogDetails.ts:41` (queryFn); `invalidateLogListing` at
  `app/App.tsx:154` (host `backgroundUpdate`, focused case); `clearData` at
  `app/log-list/ViewerOptionsPopover.tsx:35`.
- Inventory — interior duplication: `ReplicationService`
  (`log_data/replicationService.ts`) lifecycle triple + `_pendingSync`/
  `_syncQueued` queue; direct `syncLogs()` call in `clientEventsTick`
  (`useLogsSync.ts:37`); `injectedApi`/`requireApi`
  (`replicationControl.ts:15,29`) vs ambient `getApi()`
  (`useLogsSync.ts:69`).
- Inventory — invalidation split: `invalidateLogListing` in log_data vs
  `invalidateSelectedLog` in `state/selectedLogDetails.ts:61` (called by
  `refreshLog`, `state/actions.ts:38`).
