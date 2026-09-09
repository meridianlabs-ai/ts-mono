# Evaluation timeline

The log-level Timeline workspace tab: a synchronized chart and history list of
sample activity, model connections, retries, configuration changes, and early
stopping across the evaluation run.

## Sub-features

- `timeline-chart` plots run duration, sample activity, connection bands, and
  markers against a common time window.
- `timeline-history` lists the same events with human-readable labels and
  provenance.
- `timeline-filters` toggles lanes/models and event categories and persists
  state per log.
- `timeline-selection` keeps chart markers, list rows, minimap/range, and
  programmatic links from Task/Models/Samples in sync.
- `timeline-live` extends active sample series while a run is in progress.

## How to get to it (user POV)

- Open a log and choose `Timeline`.
- Click markers or history rows, change filters/range, and use links from
  changed-config chips, model usage, or the Samples tab.

## Driving it with Playwright

- Preconditions: use a log with `log_updates`, `config_updates`, connection
  history, retries, or overlapping samples. A plain completed fixture may
  render a valid but sparse timeline.
- Assert visible lane/filter labels and fixture-specific marker/history text.
  Click a history row and assert the corresponding chart selection/popover.
- Toggle one model or event class and assert both chart and history respond.
- Enter via a Config change or View Timeline action elsewhere and assert the
  selected tab plus focused time range/filter.
- For a running log, wait on a visible active-series change rather than a
  fixed delay; assert settled markers after completion.

## Code landmarks

- Tab orchestration: `apps/inspect/src/app/log-view/tabs/timeline/TimelineTab.tsx`.
- Chart/list renderers: `TimelineChart.tsx` and `HistoryList.tsx` in the same
  directory; data shaping is `timelineData.ts`.
- Cross-tab handoff and persisted keys:
  `apps/inspect/src/app/log-view/useShowTimeline.ts`.
- Effective configuration and usage connection history:
  `packages/inspect-common/src/utils/effectiveConfig.ts` and
  `packages/inspect-components/src/usage/connectionHistory.ts`.
- Regression coverage: `timelineData.test.ts`, usage connection-history tests,
  and relevant routing/property-bag tests.

## Gotchas

- This is the evaluation-level Timeline tab, not the sample Transcript's
  swimlane timeline. A screenshot with workspace tabs belongs here; one with
  event cards/outline belongs to `transcript.md`.
- Sparse logs legitimately omit lanes and filters. Do not verify complex
  markers against the viewer-rich baseline unless the underlying log has them.
- Updates carry provenance and apply in order. Sorting by label or render
  arrival can corrupt the effective history.
- Programmatic entry sets more than the workspace tab: it may also seed time
  range, lane, model, or selected marker in persisted property bags.
