import {
  ColumnSizingState,
  RowSelectionState,
  SortingState,
} from "@tanstack/react-table";

import type { ColumnFilter } from "@tsmono/inspect-components/columnFilter";

import { ColumnSizingStrategyKey } from "../app/components/columnSizing";
import { TranscriptInfo } from "../types/api-types";

import type { StoreSlice } from "./store";

// Transcripts table UI state
export interface TranscriptsTableState {
  columnSizing: ColumnSizingState;
  columnOrder: string[];
  sorting: SortingState;
  rowSelection: RowSelectionState;
  focusedRowId: string | null;
  columnFilters: Record<string, ColumnFilter>;
  visibleColumns?: Array<keyof TranscriptInfo>;
  sizingStrategy: ColumnSizingStrategyKey;
  manuallyResizedColumns: string[];
}

// The transcripts list: its source directory and table state.
export interface TranscriptsSlice {
  transcriptsDir?: string;
  transcriptsTableState: TranscriptsTableState;

  setTranscriptsDir: (path: string) => void;
  setTranscriptsTableState: (
    updater:
      | TranscriptsTableState
      | ((prev: TranscriptsTableState) => TranscriptsTableState)
  ) => void;
}

export const createTranscriptsSlice: StoreSlice<TranscriptsSlice> = (set) => ({
  transcriptsTableState: {
    columnSizing: {},
    columnOrder: [],
    sorting: [{ id: "date", desc: true }],
    rowSelection: {},
    focusedRowId: null,
    columnFilters: {},
    sizingStrategy: "fit-content",
    manuallyResizedColumns: [],
  },

  setTranscriptsDir: (path: string) => {
    set((state) => {
      state.transcriptsDir = path;
    });
  },
  setTranscriptsTableState: (updater) => {
    set((state) => {
      state.transcriptsTableState =
        typeof updater === "function"
          ? updater(state.transcriptsTableState)
          : updater;
    });
  },
});
