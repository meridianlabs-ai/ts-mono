# Dataframe migration verification

Scout's scanner dataframe was the last runtime AG Grid consumer. It now uses
TanStack Table, the shared VirtualList, the existing column sizing strategy, and
the shared column filter controls. The dataframe uses its own state key, so any
old AG Grid layout is ignored rather than translated.

The main store is restored only in VS Code, where the webview can be destroyed
and recreated. Normal browser use supplies `NoPersistence`; the separate user
settings store persists presets and theme preferences, not dataframe layout.
Browser test fixtures use localStorage solely as a stand-in for webview state.

`ag-grid-community`, `ag-grid-react`, `ag-stack`, and `ag-charts-types` are absent
from workspace manifests and `pnpm-lock.yaml`. The module registration and AG Grid
CSS variables are removed. Historical migration notes remain as documentation.

## Comparison with the old implementation

The browser fixture was committed at `51060337` before the implementation changed.
That commit is the AG Grid baseline. The same six initial browser tests passed on
both implementations. A further 21 table-driven filter cases were run against
both implementations in a detached baseline checkout.

The fixture deliberately includes negative numbers, duplicate numeric values,
nulls, empty strings, booleans, nested objects, commas, quotes, embedded newlines,
and strings exceeding the display truncation limit. The large scenario has 5,000
rows, including repeated long explanations.

| Behavior | Evidence |
| --- | --- |
| Numeric sorting and reset to original order | Browser sort cycles with row activation after each sort; unit coverage for nulls, dates, booleans, objects and case-sensitive strings |
| Text, number and compound filtering | 21 cases compared against both grids, now fast native filter unit tests; browser coverage exercises the real filter popup and compound filters |
| Saved preferences | VS Code adapter round-trip and browser non-persistence tests; current filters, widths, pinned column order, selected row and both scroll axes restored across webview recreation |
| Navigation | Double-click and row-number activation; first/last keyboard jumps; arrows work after toolbar clicks while Enter activates the focused button; input editing and resizing do not open results; empty tables remain inert |
| Large and wrapped tables | Fewer than 100 rendered rows from 5,000 records; varied wrapped heights and a 1,667-row filtered view both reach the final row and restore after unmount/reload |
| Columns | Picker changes, drag reorder, pointer/keyboard resizing, double-click auto-size, pinning/unpinning and sticky row numbers during horizontal scrolling |
| CSV | Parsed exports verify filtered/sorted records, chosen columns and escaped quotes/newlines; unit and browser checks cover truncation, clipboard, download BOM and sanitized filename |
| App integration | Real scan page with MSW responses and Arrow IPC data; hidden-column filters stay active for the table, footer and CSV, clearing removes them before columns are shown again, and rows open the correct result route |
| Appearance | Light/dark screenshots before and after, including wrapping; manually reviewed for clipping and row/header alignment |

Two existing edge cases were corrected during migration: keyboard navigation now
bounds itself to the filtered row count, and CSV buttons produce output. The old
registration omitted `CsvExportModule`; it was registered **only in the temporary
baseline fixture** to verify the intended export behavior. The new implementation
needs no export package. The one-time byte comparison and CSV artifact were
removed after that comparison; permanent tests validate the exported data rather
than requiring AG Grid's exact serialization.

The filter popup now uses the same controls as the other TanStack tables.
Automatic column widths and minor spacing can differ from AG Grid's measurements;
long values still truncate or wrap, and widths remain resizable and survive
VS Code webview recreation.

The shared resize handle adds a keyboard tab stop to each column in all Scout
DataGrids, with arrow-key resizing and Enter to auto-size where supported.
Default maximum widths remain 600 pixels for DataGrid and 800 for the dataframe.

## Keeping the implementation and tests maintainable

- TanStack owns pinning order and sticky offsets. The dataframe shares the column
  resize handle, sizing strategy and filter controls with other tables. It keeps
  its own small renderer because wrapped rows and in-place result activation do
  not fit the existing fixed-height DataGrid's navigation contract.
- The table and footer consume one filtered dataset. This removes count
  synchronization and the migration's general-purpose `useValueChange` hook.
  The formatter exposes only the mode the app uses.
- Grid updates use the current store state, including clearing filters. A browser
  regression test batches two column resizes and a clear to verify neither width
  is lost before React commits the next render.
- The dataframe owns scroll state. VirtualList accepts that initial offset
  and applies its existing measurement-aware restoration; its separate snapshot
  persistence is disabled for this view. Keyboard jumps settle through row
  measurement and yield to subsequent user input.
- The 21 filter cases run as native unit tests. Browser tests cover real controls,
  persistence, exports, navigation, virtualization and the scan page integration.
  Wrapping tests assert height changes instead of merely taking screenshots.
  The old CSV golden file and its Git attributes are gone.
- There is no legacy state translation or custom Zustand merge. Current state
  restores directly, and a separate dataframe key prevents stale AG Grid state
  from reaching TanStack. Filter range endpoints, null handling and sorting stay
  compatible because changing those would change which results users see.

## Verification results

- `pnpm check`: all 33 tasks passed, including lint, typecheck, format, workspace
  dependency checks and the suppression ledger. Six obsolete suppressions were
  removed; none were added.
- `pnpm test --concurrency=1 -- --maxWorkers=3`: all 3,654 tests passed across
  nine packages. Worker counts were bounded to avoid local CPU contention.
- `pnpm --filter scout e2e --reporter=line --workers=3`: all 82 tests passed,
  including 17 dataframe tests (21 filter cases moved to unit tests).
- `pnpm --filter scout run build:app` and `build:lib`: both passed.
- `pnpm --recursive why ag-grid-community ag-grid-react ag-stack ag-charts-types`:
  no dependencies found.
- Inspect's full browser suite: 105 passed, one existing failure in
  `turn-navigation.spec.ts`, “sibling hop from a deep-linked sample lands with
  expanded chrome.” The isolated test also fails at the same assertion (line 925)
  on `51060337`, using that checkout's original React and theme packages. This
  migration does not change that navigation behavior.

## Screenshots

Before/after screenshots in light and dark themes, including wrapped rows, are
attached to the pull request description rather than stored in the repository.
