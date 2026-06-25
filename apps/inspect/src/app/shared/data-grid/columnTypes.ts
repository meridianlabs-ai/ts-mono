import { ColumnDef } from "@tanstack/react-table";

/**
 * Comparator carried on a column for client-side sorting. Mirrors the AG Grid
 * comparator signature so the existing `gridComparators` helpers can be reused
 * verbatim. Unused in phase 1 (no sorting yet); consumed by LogListGrid's sort
 * memo in phase 2.
 */
export type ColumnComparator<TRow> = (
  valueA: unknown,
  valueB: unknown,
  rowA: TRow,
  rowB: TRow,
  isDescending: boolean
) => number;

export interface BaseColumnMeta<TRow> {
  /** Text alignment for the column. */
  align?: "left" | "center" | "right";
  /** Client-side sort comparator (phase 2). */
  sortComparator?: ColumnComparator<TRow>;
}

/**
 * Column definition for the inspect-local DataGrid: TanStack's `ColumnDef`
 * plus a few rendering helpers. `size` / `minSize` / `maxSize` come from
 * TanStack's own `ColumnDef`.
 */
export type ExtendedColumnDef<TRow> = ColumnDef<TRow> & {
  meta?: BaseColumnMeta<TRow>;
  /** Tooltip text for the column header. */
  headerTitle?: string;
  /** Tooltip text for a cell, derived from the full row. */
  titleValue?: (row: TRow) => string | undefined;
  /**
   * Plain-text representation of a cell for find/measurement. Return null to
   * skip. Unused in phase 1; consumed by the find index in phase 4.
   */
  textValue?: (row: TRow) => string | null;
};
