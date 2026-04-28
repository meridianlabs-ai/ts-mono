import type { ColDef, GridState } from "ag-grid-community";
import type { AgGridReact } from "ag-grid-react";
import { RefObject, useCallback, useEffect, useMemo } from "react";

import { useStore } from "../../../state/store";
import { getFieldKey } from "../gridUtils";

import { SampleGridScope } from "./types";

interface UseSampleGridStateResult {
  columnVisibility: Record<string, boolean>;
  /** Wraps the underlying setter: filters for columns being hidden are
   *  cleared first so they don't linger as invisible state. */
  setColumnVisibility: (visibility: Record<string, boolean>) => void;
  gridState: GridState | undefined;
  setGridState: (state: GridState) => void;
  clearGridState: () => void;
}

/**
 * Per-scope persistence for the shared samples grid. Each scope
 * (`samplesPanel` | `logViewSamples`) has its own column-visibility map
 * and ag-grid GridState. Defaults are seeded from the supplied
 * `defaultsForUnseededColumns` predicate the first time a column is
 * encountered with no entry in the visibility map; user toggles take
 * precedence after that.
 */
export function useSampleGridState<TRow>(
  scope: SampleGridScope,
  allColumns: ColDef<TRow>[],
  options?: {
    defaultsForUnseededColumns?: (col: ColDef<TRow>) => boolean;
    /** Used to clear ag-grid filters for columns being hidden. */
    gridRef?: RefObject<AgGridReact<TRow> | null>;
  }
): UseSampleGridStateResult {
  const { defaultsForUnseededColumns, gridRef } = options ?? {};
  const columnVisibility = useStore(
    (state) => state.logs.samplesListState.byScope[scope].columnVisibility
  );
  const gridState = useStore(
    (state) => state.logs.samplesListState.byScope[scope].gridState
  );
  const setSamplesColumnVisibility = useStore(
    (state) => state.logsActions.setSamplesColumnVisibility
  );
  const setSamplesGridState = useStore(
    (state) => state.logsActions.setSamplesGridState
  );
  const clearSamplesGridState = useStore(
    (state) => state.logsActions.clearSamplesGridState
  );

  // Seed visibility for any column not yet in the map, the first time we
  // see it. After that the persisted value wins.
  useEffect(() => {
    if (!defaultsForUnseededColumns) return;
    const additions: Record<string, boolean> = {};
    let changed = false;
    for (const col of allColumns) {
      const key = getFieldKey(col);
      if (!(key in columnVisibility)) {
        additions[key] = defaultsForUnseededColumns(col);
        changed = true;
      }
    }
    if (changed) {
      setSamplesColumnVisibility(scope, { ...columnVisibility, ...additions });
    }
  }, [
    allColumns,
    columnVisibility,
    defaultsForUnseededColumns,
    scope,
    setSamplesColumnVisibility,
  ]);

  const setColumnVisibility = useCallback(
    (visibility: Record<string, boolean>) => {
      // Clear filters for columns being hidden so invisible filter state
      // doesn't persist out of view.
      const api = gridRef?.current?.api;
      if (api) {
        const current = api.getFilterModel() ?? {};
        const next: Record<string, unknown> = {};
        let removed = false;
        for (const [field, filter] of Object.entries(current)) {
          if (visibility[field] === false) {
            removed = true;
          } else {
            next[field] = filter;
          }
        }
        if (removed) api.setFilterModel(next);
      }
      setSamplesColumnVisibility(scope, visibility);
    },
    [gridRef, scope, setSamplesColumnVisibility]
  );

  const setGridState = useCallback(
    (state: GridState) => {
      setSamplesGridState(scope, state);
    },
    [scope, setSamplesGridState]
  );

  const clearGridState = useCallback(() => {
    clearSamplesGridState(scope);
  }, [scope, clearSamplesGridState]);

  return useMemo(
    () => ({
      columnVisibility,
      setColumnVisibility,
      gridState,
      setGridState,
      clearGridState,
    }),
    [
      columnVisibility,
      setColumnVisibility,
      gridState,
      setGridState,
      clearGridState,
    ]
  );
}
