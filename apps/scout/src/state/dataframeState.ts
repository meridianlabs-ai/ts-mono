import type {
  ColumnPinningState,
  ColumnSizingState,
  SortingState,
} from "@tanstack/react-table";

import type { ColumnFilter } from "@tsmono/inspect-components/columnFilter";

// A separate key keeps any old AG Grid state out of this table.
export const GRID_STATE_NAME = "ScannerDataframe";

export interface DataframeState {
  sorting: SortingState;
  columnOrder: string[];
  columnSizing: ColumnSizingState;
  columnFilters: Record<string, ColumnFilter>;
  columnPinning: ColumnPinningState;
  scroll: { top: number; left: number };
}

export const emptyDataframeState: DataframeState = {
  sorting: [],
  columnOrder: [],
  columnSizing: {},
  columnFilters: {},
  columnPinning: { start: [], end: [] },
  scroll: { top: 0, left: 0 },
};
