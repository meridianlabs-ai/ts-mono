import { useCallback } from "react";

import { useStore } from "../../../state/store";
import {
  ColumnSizingTableState,
  useColumnSizing as useColumnSizingGeneric,
  UseColumnSizingResult,
} from "../../components/columnSizing";
import { ScanColumn, ScanRow } from "../columns";

interface UseColumnSizingOptions {
  /** Column definitions */
  columns: ScanColumn[];
  /** Reference to the table element for DOM measurement */
  tableRef: React.RefObject<HTMLTableElement | null>;
  /** Current data for content measurement */
  data: ScanRow[];
}

/** Column sizing for the scans grid, persisted in `scansTableState`. */
export function useColumnSizing(
  options: UseColumnSizingOptions
): UseColumnSizingResult {
  const columnSizing = useStore((state) => state.scansTableState.columnSizing);
  const sizingStrategy = useStore(
    (state) => state.scansTableState.sizingStrategy
  );
  const manuallyResizedColumns = useStore(
    (state) => state.scansTableState.manuallyResizedColumns
  );
  const setScansTableState = useStore((state) => state.setScansTableState);

  // useCallback for identity correctness, not performance: the generic
  // hook's applyAutoSizing keys on this adapter, and the grids run
  // applyAutoSizing from effects that depend on it — an unstable adapter
  // would re-fire those effects (each of which writes to the store) on
  // every render if the compiler ever bails on this hook.
  const setTableState = useCallback(
    (updater: (prev: ColumnSizingTableState) => ColumnSizingTableState) => {
      setScansTableState((prev) => ({ ...prev, ...updater(prev) }));
    },
    [setScansTableState]
  );

  return useColumnSizingGeneric({
    ...options,
    tableState: { columnSizing, sizingStrategy, manuallyResizedColumns },
    setTableState,
  });
}
