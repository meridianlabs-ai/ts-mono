# Shared grid behavior

Interaction rules shared by the log list, the samples-in-log grid, and the
cross-log Samples view: sorting, filtering, find, columns, resizing,
reordering, virtualization, keyboard selection, and persisted view state.

## Sub-features

- `grid-sort-filter` sorts by a header and filters from per-column controls.
- `grid-find` opens the Cmd/Ctrl-F band, counts matches, and steps selection.
- `grid-columns` shows/hides, resizes, reorders, and auto-sizes columns.
- `grid-keyboard` moves selection with arrows and activates with Enter.
- `grid-state` restores sort/filter/order/widths for the same scope without
  leaking them into another folder, route family, or grid kind.
- `grid-virtualization` renders a window while footer counts describe the full
  result set.

## How to get to it (user POV)

- Use Tasks, Folders, or Samples and interact with the grid headers, Columns
  menu, column dividers, rows, and footer.
- Open a log's Samples tab for the per-log sample grid.
- Navigate away and back, or switch route families, to exercise persistence
  and isolation.

## Driving it with Playwright

- Scope first to the named grid (`Evaluation logs` or `Samples`), then to a
  column via its visible header or cell `data-col-id`.
- Sort a column through ascending, descending, and none. Assert visible order
  and the indicator state; do not infer sort solely from the icon class.
- Apply one column filter, assert the canonical footer count, hide that column,
  and assert its filter no longer affects results.
- Resize a divider with Playwright pointer input, record the header width,
  navigate into a detail and back, and assert the width is retained within a
  small rendering tolerance.
- Use ArrowUp/ArrowDown and Enter from a focused cell. Assert the selected row
  and destination URL.
- Switch Tasks ↔ Folders ↔ Samples and nested folders. Each scope restores its
  own state and a fresh scope starts clean.

## Code landmarks

- Shared mechanics: `apps/inspect/src/app/shared/data-grid/DataGrid.tsx` plus
  `keyboardNav.ts`, `autoSize.ts`, `columnFit.ts`, `columnReorder.ts`, and
  `findMatches.ts` in the same directory.
- Log-specific columns/state: `apps/inspect/src/app/log-list/grid/` and
  `apps/inspect/src/app/log-list/LogsPanel.tsx`.
- Sample-specific columns/state:
  `apps/inspect/src/app/shared/samples-grid/`,
  `apps/inspect/src/app/samples/list/useSamplesView.ts`, and
  `apps/inspect/src/app/shared/samples-grid/useSampleGridState.ts`.
- Shared filter UI and evaluation: `packages/inspect-components/src/columnFilter/`.
- Regression coverage: `apps/inspect/src/app/shared/data-grid/*.test.tsx`,
  `apps/inspect/e2e/log-list-filters.spec.ts`,
  `log-list-find.spec.ts`, and `top-level-views.spec.ts`.

## Gotchas

- Virtualized DOM row counts are not dataset counts. Use footer text or a
  fixture-specific visible row.
- Sort/filter/order/size use different persisted keys. One behavior restoring
  does not prove the others.
- Dynamic scorer columns arrive after preview data. Widths must stay stable as
  the column schema fills in; snapping during load usually belongs to grid
  state reconciliation, not CSS.
- Hiding a filtered column intentionally clears its filter so an invisible
  condition cannot keep narrowing the data.
- The same `Samples` grid name is used in per-log and cross-log contexts;
  establish the URL/scope before selecting it.
