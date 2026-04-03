import type { ColDef } from "ag-grid-community";
import type { AgGridReact } from "ag-grid-react";
import type { RefObject } from "react";

import { debounce } from "@tsmono/util";

/**
 * Gets the field key from a column definition.
 * Returns the field name, header name, or "?" as fallback.
 *
 * @param col - AG Grid column definition
 * @returns The field key for the column
 */
export const getFieldKey = <T>(col: ColDef<T>): string => {
  return col.field || col.headerName || "?";
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
