# Sample list

The grid of samples for one log (the log view's default tab) and the
top-level Samples view that lists samples across all logs. Rows show id,
epoch, input, target, answer, score, and status; activating a row opens the
sample detail.

## Sub-features

- `samples-in-log` lists a log's samples in the log view's Samples tab.
- `samples-open` opens a sample's detail from a row.
- `samples-global` lists samples across logs in the top-level Samples view.

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

## Gotchas

- Both grids are named "Samples" — on a page that could have either, scope
  by URL first.
- The samples grid is virtualized; with viewer-grid's 24 rows, assert
  visible rows or scroll deliberately, don't count DOM rows and expect 24.
- Sample ids in URLs are `encodeURIComponent`'d before path encoding; ids
  containing `/` need double care — build URLs with the same encoding.
- The log view tab is labeled `Sample` (singular) when the log has exactly
  one sample — match `/^Samples?$/`.
