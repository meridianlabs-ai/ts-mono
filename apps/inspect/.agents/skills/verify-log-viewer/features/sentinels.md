# Sentinels

What a sentinel (`inspect_sentinel`, inside the eval or remote behind a model
proxy) did: the eval's Sentinels tab, a sample's sentinel panel in its Info
tab, and the step card each judged step gets in the transcript.

## Sub-features

- `sentinels-eval-tab` is the log workspace tab, shown only when
  `EvalStats.sentinel_stats` has an entry: a switch per sentinel, its
  activity (checked, decisions, human review, recorded calls), configuration
  (stages, the stack from `EvalConfig.sentinel`) and the samples worth opening
  (terminated, not checked, left out as incomplete).
- `sentinels-sample-panel` is the same panel for one sample, under Usage in
  the Info tab, from the sample's `sentinel_stats`, listing its notable steps
  with links into the transcript.
- `sentinel-step-card` is the inset in a tool card (or a standalone
  `Sentinel` row): verdict, labelled time, remote chip, the check tree with
  per-check bars, and each check's detail table.

## How to get to it (user POV)

- Open a log whose sentinels recorded stats and choose `Sentinels`; switch
  sentinels with the segmented control beside the title; follow `open →`.
- Open a sample, choose `Info`, and follow `show step →` from the Steps list.
- In a sample's `Transcript`, open a tool card's `N checks` pill and a check
  row.

## Driving it with Playwright

- No default fixture has sentinel data. Build one from a mockllm run by
  injecting `SentinelEvent`s, `sentinel_stats` and `config.sentinel` with
  inspect_ai's log API, and gate the drive with `test.skip` when it's absent.
- Deep-link to `/#/logs/<file>/sentinels`; assert the sentinel's name, its
  "N of M" checked figure and a sample id from the Samples list.
- Assert a step card's `judged in` label and a check row's duration; open a
  row and assert the detail table's labels (Working time, Request).
- Locate the switch segments and links by role and visible label.

## Code landmarks

- Eval tab: `apps/inspect/src/app/log-view/tabs/SentinelsTab.tsx`, wired in
  `apps/inspect/src/app/log-view/LogView.tsx`.
- Sample panel wiring: `apps/inspect/src/app/samples/SampleDisplay.tsx`
  (`usageViewsForSample`).
- Panel and its derivations: `packages/inspect-components/src/sentinel-stats/`
  (`SentinelStatsPanel.tsx`, `sentinelConfig.ts`, `notableSteps.ts`,
  `notableSamples.ts`).
- Step card: `packages/inspect-components/src/transcript/SentinelEventView.tsx`
  and `packages/inspect-components/src/transcript/ToolCheckInset.tsx`; step
  grouping and pairing in
  `packages/inspect-components/src/transcript/transform/toolSentinels.ts`.
- Stats normalization: `packages/inspect-common/src/normalize/sentinelStats.ts`.

## Gotchas

- A remote step's event times are when Inspect wrote them
  (inspect_sentinel#229), so its check rows show durations without bars, and
  its detail leaves out Completed.
- Stats are keyed by the sentinel's root instance name (`concurrent` for a
  mapping or list); only the in-eval sentinel has a stack, from the config.
- A chunked sample's shell has no events, so its panel lists no steps.
- The eval tab's Samples list reads the sample summaries' `sentinel_stats`;
  a sample in more than one group is listed once, in the first.
