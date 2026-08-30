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

  const setTableState = (
    updater: (prev: ColumnSizingTableState) => ColumnSizingTableState
  ) => {
    setScansTableState((prev) => ({ ...prev, ...updater(prev) }));
  };

  return useColumnSizingGeneric({
    ...options,
    tableState: { columnSizing, sizingStrategy, manuallyResizedColumns },
    setTableState,
  });
}
