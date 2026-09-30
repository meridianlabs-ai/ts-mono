import {
  ColumnSizingState,
  RowSelectionState,
  SortingState,
} from "@tanstack/react-table";

import type { ColumnFilter } from "@tsmono/inspect-components/columnFilter";

import { ColumnSizingStrategyKey } from "../app/components/columnSizing";
import type { ScanColumnKey } from "../app/scans/columns";

import type { StoreSlice } from "./store";

// Scans table UI state
export interface ScansTableState {
  columnSizing: ColumnSizingState;
  columnOrder: ScanColumnKey[];
  sorting: SortingState;
  rowSelection: RowSelectionState;
  focusedRowId: string | null;
  columnFilters: Record<string, ColumnFilter>;
  visibleColumns?: ScanColumnKey[];
  sizingStrategy: ColumnSizingStrategyKey;
  manuallyResizedColumns: string[];
}

// The list of scans (as opposed to one open scan, see scanSlice).
export interface ScansSlice {
  visibleScanJobCount?: number;
  scansTableState: ScansTableState;

  setVisibleScanJobCount: (count: number) => void;
  setScansTableState: (
    updater: ScansTableState | ((prev: ScansTableState) => ScansTableState)
  ) => void;
  clearScansState: () => void;
}

export const createScansSlice: StoreSlice<ScansSlice> = (set) => ({
  scansTableState: {
    columnSizing: {},
    columnOrder: [],
    sorting: [{ id: "timestamp", desc: true }],
    rowSelection: {},
    focusedRowId: null,
    columnFilters: {},
    sizingStrategy: "fit-content",
    manuallyResizedColumns: [],
  },

  setVisibleScanJobCount: (count: number) =>
    set((state) => {
      state.visibleScanJobCount = count;
    }),
  setScansTableState(updater) {
    set((state) => {
      state.scansTableState =
        typeof updater === "function"
          ? updater(state.scansTableState)
          : updater;
    });
  },
  // Resets the open-scan selection (scanSlice fields) when leaving the list.
  clearScansState: () => {
    set((state) => {
      state.selectedResultsView = undefined;
      state.selectedFilter = undefined;
      state.selectedScanner = undefined;
      state.selectedScanResult = undefined;
      state.displayedScanResult = undefined;
      state.sortResults = undefined;
    });
  },
});
