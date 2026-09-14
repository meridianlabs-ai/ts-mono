# Dataframe migration verification

Scout's scanner dataframe was the last runtime AG Grid consumer. It now uses
TanStack Table, the shared VirtualList, the existing column sizing strategy, and
the shared column filter controls. Saved AG Grid preferences are translated when
the store hydrates, including sort order, compound filters, column order, widths,
pinning, and scroll position.

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
| Text, number and compound filtering | 21 old/new cases, including case-insensitive text, blank/negative semantics, numeric range endpoints and object JSON; real filter popup interaction |
| Saved preferences | Legacy state normalization tests; browser hydration of old filters/sorting; new filters, widths, selected row and scroll restored across unmount/reload |
| Navigation | Double-click and row-number activation; first/last keyboard jumps; input editing and resizing do not open results; empty tables remain inert |
| Large and wrapped tables | Fewer than 100 rendered rows from 5,000 records; filter down to 1,667, reach the final displayed row, unmount and reload |
| Columns | Picker changes, drag reorder, pointer/keyboard resizing, double-click auto-size, pinning/unpinning and sticky row numbers during horizontal scrolling |
| CSV | Byte-for-byte comparison with a captured AG Grid export; filtered/sorted rows, chosen columns, escaping, truncation, clipboard, download BOM and sanitized filename |
| App integration | Real scan page with MSW responses and Arrow IPC data; footer count updates and opening the correct result route |
| Appearance | Light/dark screenshots before and after, including wrapping; manually reviewed for clipping and row/header alignment |

Two existing edge cases were corrected during migration: keyboard navigation now
bounds itself to the filtered row count, and CSV buttons produce output. The old
registration omitted `CsvExportModule`; it was registered **only in the temporary
baseline fixture** to capture the intended export contract in
`e2e/fixtures/dataframe/expected.csv`. The new implementation needs no export
package. Git preserves the fixture's CRLF records and embedded LF verbatim.

The filter popup now uses the same controls as the other TanStack tables.
Automatic column widths and minor spacing can differ from AG Grid's measurements;
long values still truncate or wrap, and widths remain resizable and persisted.

## Verification results

- `pnpm check`: all 33 tasks passed, including lint, typecheck, format, workspace
  dependency checks and the suppression ledger. Six obsolete suppressions were
  removed; none were added.
- `pnpm test`: all 3,635 tests passed across nine packages.
- `pnpm --filter scout e2e --reporter=line --workers=3`: all 100 tests passed,
  including 35 dataframe tests.
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
