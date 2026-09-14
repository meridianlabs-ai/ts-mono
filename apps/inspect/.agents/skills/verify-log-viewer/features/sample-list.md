# Sample list

The grid of samples for one log (the log view's default tab) and the
top-level Samples view that lists samples across all logs. Rows show id,
epoch, input, target, answer, score, and status; activating a row opens the
sample detail.

## Sub-features

- `samples-in-log` lists a log's samples in the log view's Samples tab.
- `samples-open` opens a sample's detail from a row.
- `samples-global` lists samples across logs in the top-level Samples view.
- `samples-filter-sort` supports the sample filter language, per-column
  filters, scorer selection, sorting, and Reset Filters.
- `samples-columns-view` persists columns/widths and toggles multiline,
  compact scores, and score color scales.
- `samples-status-fields` promotes error, limit, retries, and fallback columns
  when data exists and keeps score/status semantics consistent with detail.
- `samples-single` renders a single sample inline instead of a pointless
  one-row grid where that mode applies.

## How to get to it (user POV)

- Open any log from the log list — the log view lands on its Samples tab.
- Direct: `#/logs/<encodedLogPath>` (defaults to the samples tab) or
  `#/logs/<encodedLogPath>/samples`.
- Navbar segmented control → `Samples` for the cross-log view (`#/samples`).

## Driving it with Playwright

Preconditions:

- Baseline launch. `viewer-rich` (5 samples) or `viewer-grid` (24 samples,
  for virtualization) as the target log.

- **Grid renders.** `page.goto("/#/logs/" + encodeURIComponent(logFile))`,
  then `page.getByRole("grid", { name: "Samples" })` is visible. Column ids
  for `data-col-id`: `displayIndex`, `sampleId`, `epoch`, `input`, `target`,
  `answer`, `tokens`, `duration`, `error`, `limit`.
- **Content is the fixture's.** For viewer-rich:
  `samplesGrid.getByRole("gridcell").filter({ hasText: "What is 2+2?" }).first()`
  is visible.
- **Open a sample.** Click that gridcell, then
  `page.waitForURL(/\/samples\/sample\//)` and
  `page.locator("[id^='sample-heading-']")` is visible — the sample header
  with input/target/answer/score.
- **Cross-log view.** `page.getByRole("navigation").getByRole("button", { name: "Samples" })`;
  the same `grid` named "Samples" renders rows from multiple logs (extra
  columns `task`, `logFile`). Opening a row routes to
  `#/samples/<logPath>/sample/<id>/<epoch>/...`.
- **Proof.** Screenshot the grid and the opened sample detail; assert the
  fixture's input text and sample count.

- **Filter/view controls.** In a multi-sample log, fill the sample filter,
  assert the canonical footer count and matching rows, then toggle `View` →
  Multiline / Compact scores / Score colors as the fixture permits.
- **Columns.** Use `Columns` to hide/show an optional status field; hiding a
  filtered column clears its filter. Follow
  [Shared grid behavior](./shared-grid-behavior.md) for persistence coverage.

## Code landmarks

- Per-log tab: `apps/inspect/src/app/log-view/tabs/SamplesTab.tsx`.
- Cross-log panel: `apps/inspect/src/app/samples-panel/SamplesPanel.tsx`.
- Sample list/view controls: `apps/inspect/src/app/samples/list/`,
  `apps/inspect/src/app/samples/SamplesTools.tsx`, and
  `apps/inspect/src/app/samples/sample-tools/`.
- Shared row/columns/grid state: `apps/inspect/src/app/shared/samples-grid/`.
- Listing data: `apps/inspect/src/log_data/samplesListing.ts`,
  `sampleSummaries.ts`, and `scoreSchema.ts`.
- Regression coverage: sample view/filter/grid unit tests,
  `apps/inspect/e2e/top-level-views.spec.ts`, and `log-list-filters.spec.ts`.

## Gotchas

- Both grids are named "Samples" — on a page that could have either, scope
  by URL first.
- The samples grid is virtualized; with viewer-grid's 24 rows, assert
  visible rows or scroll deliberately, don't count DOM rows and expect 24.
- Sample ids in URLs are `encodeURIComponent`'d before path encoding; ids
  containing `/` need double care — build URLs with the same encoding.
- The log view tab is labeled `Sample` (singular) when the log has exactly
  one sample — match `/^Samples?$/`.
- Per-log and cross-log grids have different default sorting and columns. A
  state fix for one key must not overwrite the other.
- Optional error/limit/retry/fallback columns auto-promote only when the active
  data has those fields.
- Filters operate on summary/listing fields. Do not load every full sample to
  make a grid filter work.
