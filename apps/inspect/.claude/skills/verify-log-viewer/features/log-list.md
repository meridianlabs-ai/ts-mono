# Log list

The landing surface: a grid of eval logs from the served log directory, in
three top-level views (Tasks, Folders, Samples) switched by a segmented
control in the navbar. Rows show status, task, model, score, and counts;
activating a row opens that log.

## Sub-features

- `list-render` shows one row per log with status icon, task, model, score.
- `list-views` switches Tasks / Folders / Samples via the segmented control.
- `list-open` opens a log from a row (click or Enter) and routes to it.
- `list-filter` filters rows per column via the header funnel button.
- `list-find` incremental find across the grid (Cmd/Ctrl-F band).

## How to get to it (user POV)

- Open `http://localhost:5179/` — the default route is the Tasks view.
- `#/logs` is the Folders view; `#/tasks` is the Tasks view explicitly.
- The navbar segmented control switches views from anywhere.

## Driving it with Playwright

Preconditions:

- Baseline launch (features/README.md); fixture dir is the default one.

- **List renders.** `page.goto("/")`, then
  `page.getByRole("grid", { name: "Evaluation logs" })` is visible and
  `page.getByRole("gridcell").filter({ hasText: "viewer_rich" }).first()` is
  visible. Cells carry `data-col-id="<columnId>"` (`task`, `model`, `score`,
  `status`, `totalSamples`, …) for column-scoped assertions.
- **Switch views.** Scope to the navbar to avoid name collisions:
  `page.getByRole("navigation").getByRole("button", { name: "Folders" })`
  (also `"Tasks"`, `"Samples"`). After switching, the URL is `#/logs` /
  `#/tasks` and the grid re-renders.
- **Open a log.** Click a `gridcell` in the target row (rows are divs with
  onClick — there is no link role), then `page.waitForURL(/#\/tasks\//)` (or
  `/#\/logs\//` from Folders view). The log view renders with a
  `getByRole("tab", { name: /^Samples?$/ })` tab ("Sample" when the log has
  exactly one).
- **Filter a column.** In the `Task` column header:
  `header.getByRole("button", { name: "Filter task", exact: true })`, then
  `page.locator("#task-op").selectOption("contains")`,
  `page.getByPlaceholder("Filter").fill("rich")`,
  `page.getByRole("button", { name: "Apply" })`. Assert the footer count
  (below), then reset via
  `page.getByRole("button", { name: "Reset Filters" })`.
- **Row counts.** The footer (bottom right) is the canonical count — it is
  immune to virtualization. Unfiltered it reads `<N> items`; filtered it
  reads `<matched> / <N> items` (e.g. `2 / 25 items` after filtering task
  contains "rich" on the default fixtures). Assert on that text, not on DOM
  row counts.
- **Find.** `page.keyboard.press("ControlOrMeta+f")`, type into
  `page.getByPlaceholder("Find")`; `getByTestId("find-band-match-count")`
  shows `"1 of N"`; `find-band-next`/`find-band-prev` step matches.
- **Proof.** Screenshot the populated list and the opened log into
  `evidence/`; assert a task name and a score value that exist in the
  fixture (e.g. `viewer_rich`, `0.8`).

## Gotchas

- Column header accessible names include the filter funnel's aria-label —
  match header text with
  `getByRole("columnheader").filter({ has: page.getByText("Task", { exact: true }) })`,
  not by accessible name.
- Buttons whose aria-labels contain "Samples" exist outside the navbar;
  always scope the view switcher to `getByRole("navigation")`.
- The grid is virtualized: a row far down the list may not be in the DOM
  until scrolled. Filter or find instead of scrolling blindly, and count via
  the footer text, never via DOM rows.
- Sort indicators are aria-hidden icons (`i.bi-arrow-down`); assert on them
  by class if sorting is under proof.
