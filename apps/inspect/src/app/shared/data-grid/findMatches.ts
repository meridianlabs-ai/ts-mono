import { joinSearchText, primitiveText } from "../../../log_data";

import type { ExtendedColumnDef } from "./columnTypes";

/**
 * One row's searchable text: lowercased plain-text built from the visible
 * columns' `textValue` (display formatting) or raw accessor value. The
 * formatting and joining rules are the data layer's (`searchText.ts`), so
 * shaped-row matching here can't drift from the record-level schema's.
 */
export function rowSearchText<TRow>(
  row: TRow,
  columns: ExtendedColumnDef<TRow>[]
): string {
  return joinSearchText(
    columns.map((column) =>
      column.textValue
        ? column.textValue(row)
        : "accessorFn" in column && column.accessorFn
          ? primitiveText(column.accessorFn(row, 0))
          : null
    )
  );
}

/**
 * Search index for the grid find band: searchable text per row id.
 * Data-level — searches all rows, not just the virtualized window.
 * Insertion order follows `rows`, so match order is row order.
 */
export function buildSearchIndex<TRow>(
  rows: TRow[],
  columns: ExtendedColumnDef<TRow>[],
  getRowId: (row: TRow) => string
): Map<string, string> {
  const index = new Map<string, string>();
  for (const row of rows) {
    index.set(getRowId(row), rowSearchText(row, columns));
  }
  return index;
}

/** Row ids whose search text contains `term` (case-insensitive), in row
 *  order. An empty term matches nothing. */
export function findMatches(
  index: Map<string, string>,
  term: string
): string[] {
  if (!term) return [];
  const lowerTerm = term.toLowerCase();
  const ids: string[] = [];
  for (const [id, text] of index) {
    if (text.includes(lowerTerm)) ids.push(id);
  }
  return ids;
}
