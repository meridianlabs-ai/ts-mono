import type { ColDef } from "ag-grid-community";

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
