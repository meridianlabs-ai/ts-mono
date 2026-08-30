import { useStore } from "../../../state/store";
import { TranscriptInfo } from "../../../types/api-types";
import {
  ColumnSizingTableState,
  useColumnSizing as useColumnSizingGeneric,
  UseColumnSizingResult,
} from "../../components/columnSizing";
import { TranscriptColumn } from "../columns";

interface UseColumnSizingOptions {
  /** Column definitions */
  columns: TranscriptColumn[];
  /** Reference to the table element for DOM measurement */
  tableRef: React.RefObject<HTMLTableElement | null>;
  /** Current data for content measurement */
  data: TranscriptInfo[];
}

/** Column sizing for the transcripts grid, persisted in `transcriptsTableState`. */
export function useColumnSizing(
  options: UseColumnSizingOptions
): UseColumnSizingResult {
  const columnSizing = useStore(
    (state) => state.transcriptsTableState.columnSizing
  );
  const sizingStrategy = useStore(
    (state) => state.transcriptsTableState.sizingStrategy
  );
  const manuallyResizedColumns = useStore(
    (state) => state.transcriptsTableState.manuallyResizedColumns
  );
  const setTranscriptsTableState = useStore(
    (state) => state.setTranscriptsTableState
  );

  const setTableState = (
    updater: (prev: ColumnSizingTableState) => ColumnSizingTableState
  ) => {
    setTranscriptsTableState((prev) => ({ ...prev, ...updater(prev) }));
  };

  return useColumnSizingGeneric({
    ...options,
    tableState: { columnSizing, sizingStrategy, manuallyResizedColumns },
    setTableState,
  });
}
