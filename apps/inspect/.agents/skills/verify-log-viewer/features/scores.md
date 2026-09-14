# Scores

Score display at every level: the score column in the log list, the
log-level scoring summary (header grid with a detail dialog when metrics
overflow), and the per-sample Scoring tab with scorer, answer, target, and
explanation.

## Sub-features

- `scores-list-column` log-list `score` column shows the headline metric.
- `scores-log-header` log view header shows scorer/metric summary; the
  "All scoring..." button opens the Scoring Detail dialog when metrics
  overflow.
- `scores-sample-tab` sample Scoring tab shows scorer name, score value,
  answer, target, explanation.
- `scores-types` renders pass/fail, categorical, numeric, boolean, list,
  object, and other score shapes with suitable tone/labels.
- `scores-reason` shows the scorer explanation and the optional distinct
  `reason` field in both sample scoring and transcript score events.
- `scores-grid-options` sorts scorers and applies compact labels/color scales
  consistently between grids and the sample summary.

## How to get to it (user POV)

- Log list: the `Score` column on every row.
- Log view: the header above the tabs; `All scoring...` when many metrics.
- Sample detail: the `Scoring` tab
  (`#/logs/<encodedLogPath>/samples/sample/<id>/<epoch>/scoring`).

## Driving it with Playwright

Preconditions:

- Baseline launch; viewer-rich (accuracy 0.8; sample 1 scores
  `includes: C`) as the target.

- **List column.** On `/`, the viewer-rich row's score cell:
  `row.locator('[data-col-id="score"]')` contains `0.8`. Per-metric rotated
  columns are headed `"<scorer> / <metric>"` (e.g. `includes / accuracy`).
- **Log header.** Open the log; the header renders the scorer summary. With
  many metrics: `page.getByRole("button", { name: "All scoring..." })`
  opens `page.getByRole("dialog", { name: "Scoring Detail" })` whose scroll
  container is `dialog.getByTestId("score-grid")` (explicit test hook).
  viewer-rich's single scorer does NOT overflow — use a multi-metric
  fixture to prove the dialog.
- **Sample tab.** Deep-link to `/scoring`;
  `page.locator("#scoring-contents")` contains the scorer name `includes`
  and the value `C`; sort control is
  `getByRole("button", { name: "Sort scores" })`.
- **Proof.** Screenshots of the list column and the scoring tab; assert the
  numeric metric (0.8) and the sample score letter (C) — values that come
  from the fixture, not placeholders.

- **Typed values/reason.** Use a fixture whose score type and `reason` are
  known; assert the Scoring tab and Score transcript event agree without
  flattening list/object values to `[object Object]`.

## Code landmarks

- Log list/headline metrics: `apps/inspect/src/scoring/`, log-list column
  hooks, and `apps/inspect/src/app/log-view/title-view/ResultsPanel.tsx` /
  `ScoreGrid.tsx`.
- Sample scoring: `apps/inspect/src/app/samples/scores/` and descriptor types
  under `apps/inspect/src/app/samples/descriptor/score/`.
- Summary score/tone: `apps/inspect/src/app/samples/header-v2/` and
  `apps/inspect/src/app/shared/samples-grid/colorScale.ts`.
- Transcript score event: `packages/inspect-components/src/transcript/ScoreEventView.tsx`
  and `ScoreValue.tsx`.
- Regression coverage: scoring unit tests, score descriptor/grid tests,
  title-view results tests, and `apps/inspect/e2e/metrics-overflow.spec.ts`.

## Gotchas

- `getByText("C", { exact: true })` can match stray single letters — scope
  to `#scoring-contents` first.
- The Scoring Detail dialog only exists when metrics overflow the header;
  don't report `scores-log-header` proven on a one-metric fixture.
- Metric values are rounded for display — assert the displayed rounding
  (`0.8`), not full precision from the log.
- `Score.explanation` and `Score.reason` are separate optional fields; preserve
  both when present.
- List/object scores need stable structured rendering and sorting semantics;
  never compare them through implicit string coercion.
- Headline-metric selection can differ from source order and can name a grouped
  metric/reducer.
