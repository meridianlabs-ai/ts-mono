import { ColumnDef } from "@tanstack/react-table";

import type { FilterType } from "@tsmono/inspect-components/columnFilter";

/**
 * Value comparator carried on a column for client-side sorting. Sorts
 * ascending; the caller negates for descending. `isDescending` lets the
 * comparator pin missing values last regardless of direction (the AG
 * `gridComparators` contract, reused here). Folder grouping is handled by the
 * panel, so comparators are value-only (no row params).
 */
export type ColumnComparator = (
  a: unknown,
  b: unknown,
  isDescending: boolean
) => number;

export interface BaseColumnMeta {
  /** Text alignment for the column. */
  align?: "left" | "center" | "right";
  /** Client-side sort comparator (consumed by the listing query). */
  sortComparator?: ColumnComparator;
  /** Whether the column offers a header filter. */
  filterable?: boolean;
  /** Filter editor + operator set for the column (when `filterable`). */
  filterType?: FilterType;
}

/**
 * Column definition for the inspect-local DataGrid: TanStack's `ColumnDef`
 * plus a few rendering helpers. `size` / `minSize` / `maxSize` come from
 * TanStack's own `ColumnDef`.
 */
export type ExtendedColumnDef<TRow> = ColumnDef<TRow> & {
  meta?: BaseColumnMeta;
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
