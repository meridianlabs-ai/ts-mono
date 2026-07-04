# Goal: minimal, coherent log_data hook surface — answers, not mechanisms

## Intent (north star)

Every log_data hook exports an **answer to a domain question**, never a
mechanism the consumer must reassemble. The smells this goal removes, in all
their costumes: a hook that requires the caller to fetch subsystem data and
pass it back in (`useSample(handle, summary)`); three hooks that are one API
fractured along implementation seams (the completed/streaming/cached sample
trio); a hook whose data payload nobody reads because it duplicates another
hook (`useLogsSync`'s `AsyncData<LogHandle[]>`); two overlapping busy signals
consumers must hand-combine (`logsSync.loading || syncing`); a wire-format
concept exposed as an API concept (`PendingSamples`). Same smell, one fix:
the subsystem answers the question; assembly is interior.

Target surface (`log_data/index.ts`, complete):

```
imperativeLogData                          // init / fetchLog / refreshLogListing / clearData
useLogsSync(logDir, scope)                 // ListingStatus { busy, error }
useLogHandles(logDir)                      // LogHandle[]
useLogPreviews(logDir)                     // Record<string, LogPreview>
useLogDetails(logDir)                      // Record<string, LogDetails>
useLogDetail(logDir, logFile)              // one log's details
useSampleSummaries(logDir, logFile)        // SampleSummary[] (merged, live)
useRunningMetrics(logDir, logFile)         // a running eval's metrics
useSampleData(logDir, handle)              // SampleData: body/stream/status, one state machine
usePassiveEvalSample(logDir, handle)       // passive body read (fetch-free surfaces, e.g. the banner)
useDatabaseStats()                         // local-db stats (options popover)
```

Success is measured by reduction: `useSample`, `useRunningSample`,
`useCachedSample`, `usePendingSamples`, and `useFetchEngineStatus` leave the
barrel; the `useSampleData` state machine leaves `state/hooks.ts`; no summary
parameters remain on sample hooks.

## Scope

IN:

- **Sample data → one hook.** The `useSampleData` derivation
  (`state/hooks.ts:414`, ~90 lines: completed vs streaming path selection,
  cached-event bridging, finalize handoff) moves into log_data as
  `useSampleData(logDir, handle): SampleData`. The trio (`useSample`,
  `useRunningSample`, `useCachedSample`) becomes interior. The `summary`
  params die: log_data looks up the sample's merged summary itself
  (`useSampleSummaries` / `getSampleSummaries`). `SampleData` /
  `SampleStatus` types travel with the hook. state/ keeps
  `useSelectedSampleData()` as a selection binding.
- **`useSampleInvalidation(logDir, handle)`** — the passive cache read
  (today `state/hooks.ts:495` over `useCachedSample`) becomes a log_data
  export, preserving its never-fetch/never-keep-alive semantics. state/
  keeps the selection binding.
- **Pending buffer → interior.** `usePendingSamples` leaves the barrel; its
  only external consumption is `.metrics` (`LogView.tsx:42`). New export
  `useRunningMetrics(logDir, logFile)` answers that question;
  `useSampleSummaries` already answers the samples half. state/'s
  `useSelectedPendingSamples` becomes `useSelectedRunningMetrics`.
- **Listing status unified.** `useLogsSync(scope)` returns a status object
  (`busy`, `error`) instead of `AsyncData<LogHandle[]>` — no consumer reads
  the handles (FlowPanel ignores the return; LogsPanel reads `.error`;
  SamplesPanel reads `.loading`). `busy` folds in engine `syncing`, so the
  subsystem defines its own busy signal and the hand-combined
  `logsSync.loading || syncing` (`SamplesPanel.tsx:358`) dies.
  `useFetchEngineStatus` leaves the barrel; `useDatabaseStats()` serves the
  options popover's `dbStats` read.
- **One identity convention.** Every hook takes `logDir` explicitly
  (`useSample`/`useCachedSample`/`useRunningSample` read `useLogDir()`
  ambiently today — the replacement hooks take it as the first argument,
  matching the collections, `useSampleSummaries`, and the non-React
  snapshots).
- **Return-shape convention, written down** (in `domain-ownership.md`): a
  hook that can load/fail returns `AsyncData`; a passive projection returns
  the bare value (or `undefined`). Each surviving hook lands on the right
  side as it's touched.
- **`domain-ownership.md` updated**: surface list, awareness diagram,
  selected-log lifecycle bindings.

OUT (future goals):

- **Unifying the three details reads** (`useLogDetails` collection /
  `useLogDetail` row / state's `useSelectedLogQuery` third cache entry, its
  own TODO at `state/selectedLogDetails.ts:30`). Needs a design for
  `LogLoadController`'s "fetch settled" event before `useLogDetail` can
  absorb `fetchLog` — separate goal. `fetchLog` stays on
  `imperativeLogData` until then.
- Collection-identity churn workarounds (`useStableValue` at
  `grid/columns/hooks.tsx:110`) — symptom of the details-read grain; same
  future goal.
- eslint enforcement of the barrel/layering.

## Done when (all must hold)

- `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test` green (from
  `apps/inspect`).
- `log_data/index.ts` exports exactly the target surface above — nothing
  else.
- Structural invariants (greppable, scoped to `apps/inspect/src`):
  - `useSample`, `useRunningSample`, `useCachedSample`, `usePendingSamples`,
    `useFetchEngineStatus` imported nowhere outside `log_data/`.
  - No exported log_data hook takes a `summary` parameter.
  - `PendingSamples` type appears in no import outside `log_data/` and
    `client/`.
  - `rg "\.loading \|\| syncing|syncing \|\| .*\.loading" src` is empty.
  - No log_data hook body calls `useLogDir()` (params only; `state/`
    bindings do the ambient read).
  - `state/hooks.ts` contains no sample-path state machine — only selection
    bindings delegating to log_data (`useSelectedSampleData`,
    `useSelectedSampleSummaries`, `useSelectedRunningMetrics`, …).
- **Unit tests**: the moved state machine keeps table-driven coverage in
  `log_data/` (path selection, finalize handoff, error-summary fallback,
  cached-event bridging); binding hooks get thin wiring tests (seed
  selection, spy the delegate — the `hooks.wiring.test.ts` pattern).
- Behavior parity vs the current branch: streaming → completed handoff with
  no loading flash; errored-sample synthesis; invalidation banner never
  triggers a body fetch; running metrics tick while an eval runs and stop on
  completion; listing busy/error indications on the panels unchanged. Note
  any timing shifts.
- Net-subtractive outside log_data + tests (deletions ≥ insertions in
  `state/` and components). Self-assess; surface if unsure.

## Decision rubric (decide yourself — see Autonomy)

- **Answers over mechanisms**: if a consumer must combine two log_data hooks
  to answer one domain question, the surface is wrong — compose inside.
  Conversely don't pre-compose what no consumer asks for.
- **Params over ambient**: log_data hook inputs arrive as arguments or
  in-subsystem cache reads. A log_data module calling `useStore` or
  `useLogDir` is mis-layered; a state/ binding growing a queryFn has sunk
  too low.
- **Never feed a subsystem its own data**: a log_data hook parameter that a
  consumer could only obtain from another log_data hook is an interior read
  in disguise.
- **Passive reads stay passive**: `useSampleInvalidation` must not keep the
  sample query alive or trigger fetches (today's `skipToken` semantics).
- **Types**: a hook's return type is exported iff a consumer names it in an
  annotation (`SampleData` yes; keep the barrel's type surface as lean as
  its value surface). No `any`/type assertions in `src`.
- **Naming**: `useX(params)` in log_data answers "what is X for these
  params"; `useSelectedX()` bindings in state/. Domain nouns, not transport
  nouns (`RunningMetrics`, not `PendingSamples`).
- **Code health**: delete dead code, don't move it; no compat shims;
  comments say WHY not WHAT.

## Guardrails (must not break)

- Behavior parity per Done-when; note poll-cadence/timing shifts.
- Commit in the **ts-mono submodule**; parent repo gets gitlink bumps only.
  **Always ask before pushing.** Commit per phase; never commit red.
- Don't disable static-analysis warnings without discussing.

## Autonomy contract (HIGH)

- Proceed without asking on anything the rubric covers — module placement,
  status-object field names, test relocation, phase sequencing.
- Surface only: (a) a genuine fork the rubric doesn't resolve, (b) a real
  behavior/parity risk, (c) scope creep into the OUT list, (d) before
  pushing.
- Suggested phases (each independently green + committed):
  1) `useRunningMetrics`; pending buffer interior.
  2) `useLogsSync` → `ListingStatus`; `useFetchEngineStatus` retired;
     `useDatabaseStats`.
  3) `useSampleData` + `useSampleInvalidation` into log_data; trio interior;
     summary params retired; state bindings.
  4) Conventions sweep (explicit `logDir`, return shapes, naming) +
     `domain-ownership.md`.

## Current state (branch `loglist-tanstack-phase1`, ts-mono submodule)

- Precedent already landed: `useSampleSummaries(logDir, logFile)` +
  `getSampleSummaries` moved the summary merge into log_data (`360fcda2`);
  `imperativeLogData` formalized the imperative surface — the target shape
  in miniature.
- Inventory — fractured sample API: `useSampleData` state machine at
  `state/hooks.ts:414`; `summary` params at `log_data/sampleQuery.ts:55` and
  `log_data/runningSampleQuery.ts:201`; passive invalidation read at
  `state/hooks.ts:495`.
- Inventory — leaked mechanisms: `usePendingSamples` consumed externally
  only for `.metrics` (`LogView.tsx:42` via `state/hooks.ts:184`);
  `useLogsSync` payload unread (`FlowPanel.tsx:24`, `LogsPanel.tsx:82`,
  `SamplesPanel.tsx:74`); hand-combined busy at `SamplesPanel.tsx:358` and
  `LogsPanel.tsx` (ProgressBar animating).
- Inventory — convention drift: ambient `useLogDir()` inside
  `log_data/sampleQuery.ts` / `runningSampleQuery.ts`; `AsyncData` on the
  passive `useLogDetail` (its error branch documented unreachable,
  `logsContent.ts:302`) vs bare `undefined` on `usePendingSamples`.
