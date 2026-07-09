import type { ColDef } from "ag-grid-community";
import { useCallback, useEffect, useMemo } from "react";

import { useStore } from "../../../state/store";
import type { SamplesPanelGridState } from "../../types";
import { getFieldKey } from "../gridUtils";

interface UseSampleGridStateResult extends SamplesPanelGridState {
  columnVisibility: Record<string, boolean>;
  setColumnVisibility: (visibility: Record<string, boolean>) => void;
  /** Merge a partial sorting/filters/sizing update into the persisted
   *  scope entry (see `patchSamplesGridState`). */
  patchGridState: (partial: Partial<SamplesPanelGridState>) => void;
}

/**
 * Persistence for the cross-log SamplesPanel grid. Owns its own
 * column-visibility map plus the TanStack grid state (sorting, per-column
 * filters, column widths), all store-backed so they survive the panel
 * unmounting on sample navigation. Visibility defaults are seeded from
 * `defaultsForUnseededColumns` the first time a column is encountered
 * with no entry, after which user toggles win.
 *
 * The per-task SampleList scope (`logViewSamples`) flows through
 * `useSamplesView` instead — see `apps/inspect/src/app/samples/list/`.
 */
export function useSampleGridState<TRow>(
  scope: "samplesPanel",
  allColumns: ColDef<TRow>[],
  options?: {
    defaultsForUnseededColumns?: (col: ColDef<TRow>) => boolean;
  }
): UseSampleGridStateResult {
  const { defaultsForUnseededColumns } = options ?? {};
  const columnVisibility = useStore(
    (state) => state.logs.samplesListState.byScope[scope].columnVisibility
  );
  const sorting = useStore(
    (state) => state.logs.samplesListState.byScope[scope].sorting
  );
  const columnFilters = useStore(
    (state) => state.logs.samplesListState.byScope[scope].columnFilters
  );
  const columnSizing = useStore(
    (state) => state.logs.samplesListState.byScope[scope].columnSizing
  );
  const setSamplesColumnVisibility = useStore(
    (state) => state.logsActions.setSamplesColumnVisibility
  );
  const patchSamplesGridState = useStore(
    (state) => state.logsActions.patchSamplesGridState
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
      setSamplesColumnVisibility(scope, visibility);
    },
    [scope, setSamplesColumnVisibility]
  );

  const patchGridState = useCallback(
    (partial: Partial<SamplesPanelGridState>) => {
      patchSamplesGridState(scope, partial);
    },
    [scope, patchSamplesGridState]
  );

  return useMemo(
    () => ({
      columnVisibility,
      setColumnVisibility,
      sorting,
      columnFilters,
      columnSizing,
      patchGridState,
    }),
    [
      columnVisibility,
      setColumnVisibility,
      sorting,
      columnFilters,
      columnSizing,
      patchGridState,
    ]
  );
}
