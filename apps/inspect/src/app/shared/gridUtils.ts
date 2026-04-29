import type { ColDef } from "ag-grid-community";
import type { AgGridReact } from "ag-grid-react";
import type { RefObject } from "react";

import { debounce } from "@tsmono/util";

/**
 * Resolves the runtime column id ag-grid will use for a column definition.
 * Prefers an explicit `colId`, falls back to `field`, then `headerName`,
 * then `"?"`. This is what should be used both as a key into a
 * visibility/state map AND as the `colId` passed to
 * `api.applyColumnState({ state })` so the two stay in sync.
 *
 * (ag-grid itself uses `colId ?? field` as the runtime id when a column
 * has only one of the two; matching that here means a column with only
 * `colId` — like the pinned `#` index column — round-trips correctly.)
 *
 * @param col - AG Grid column definition
 * @returns The field key for the column
 */
export const getFieldKey = <T>(col: ColDef<T>): string => {
  return col.colId || col.field || col.headerName || "?";
};

/**
 * Creates a debounced resize function for AG Grid columns.
 * This function fits columns to the grid width when called.
 *
 * @param gridRef - Reference to the AG Grid React component
 * @param delayMs - Debounce delay in milliseconds (default: 10ms)
 * @returns A debounced function that resizes grid columns to fit
 */
export const createGridColumnResizer = <T>(
  gridRef: RefObject<AgGridReact<T> | null>,
  delayMs: number = 10
) => {
  return debounce(() => {
    gridRef.current?.api?.sizeColumnsToFit();
  }, delayMs);
};
