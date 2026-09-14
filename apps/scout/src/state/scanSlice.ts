import { ResultGroup, ScanResultSummary, SortColumn } from "../app/types";

import type { StoreSlice } from "./store";

// One open scan: its scanner results, the selected result dataframe, and the
// view settings that are cleared when switching scans.
export interface ScanSlice {
  // Scanner
  visibleScannerResults: ScanResultSummary[];
  visibleScannerResultsCount: number;

  // Dataframes
  selectedScanResult?: string;
  displayedScanResult?: string;

  // Scan specific properties (clear when switching scans)
  selectedResultsTab?: string;
  selectedResultTab?: string;
  selectedScanner?: string;
  selectedResultsView?: string;
  selectedFilter?: string;
  groupResultsBy?: ResultGroup;
  sortResults?: SortColumn[];
  scansSearchText?: string;
  highlightLabeled?: boolean;
  selectedResultRow?: number;
  dataframeWrapText?: boolean;
  dataframeShowFilterColumns?: boolean;
  dataframeFilterColumns?: string[];

  setSelectedScanner: (scanner: string) => void;
  setSelectedScanResult: (result: string) => void;
  setDisplayedScanResult: (result: string | undefined) => void;
  setVisibleScannerResults: (results: ScanResultSummary[]) => void;
  setVisibleScannerResultsCount: (count: number) => void;
  clearScanState: () => void;

  setSelectedResultsTab: (tab: string) => void;
  setSelectedResultTab: (tab: string) => void;
  setSelectedResultsView: (view: string) => void;
  setSelectedFilter: (filter: string) => void;
  setGroupResultsBy: (groupBy: ResultGroup) => void;
  setSortResults: (sortColumns?: SortColumn[]) => void;
  setScansSearchText: (text: string) => void;
  setHighlightLabeled: (highlight: boolean) => void;
  setSelectedResultRow: (row: number) => void;
  setDataframeWrapText: (wrap: boolean) => void;
  setDataframeFilterColumns: (columns: string[]) => void;
  setDataframeShowFilterColumns: (show: boolean) => void;
}

export const createScanSlice: StoreSlice<ScanSlice> = (set) => ({
  visibleScannerResults: [],
  visibleScannerResultsCount: 0,
  highlightLabeled: false,

  setSelectedScanner: (scanner: string) => {
    set((state) => {
      state.selectedScanner = scanner;
    });
  },
  setSelectedScanResult: (result: string) =>
    set((state) => {
      state.selectedScanResult = result;
    }),
  setDisplayedScanResult: (result: string | undefined) =>
    set((state) => {
      state.displayedScanResult = result;
    }),
  setVisibleScannerResults: (results: ScanResultSummary[]) => {
    set((state) => {
      state.visibleScannerResults = results;
    });
  },
  setVisibleScannerResultsCount(count: number) {
    set((state) => {
      state.visibleScannerResultsCount = count;
    });
  },
  // Also drops the transcript view state (transcriptSlice) shown inside the
  // scan, since it belongs to the scan being left.
  clearScanState: () => {
    set((state) => {
      state.selectedResultsTab = undefined;
      state.transcriptCollapsedEvents = {};
      state.transcriptOutlineId = undefined;
      state.selectedResultTab = undefined;
      state.groupResultsBy = undefined;
      state.scansSearchText = undefined;
      state.sortResults = undefined;
    });
  },
  setSelectedResultsTab: (tab: string) => {
    set((state) => {
      state.selectedResultsTab = tab;
    });
  },
  setSelectedResultTab: (tab: string) => {
    set((state) => {
      state.selectedResultTab = tab;
    });
  },
  setSelectedResultsView: (view: string) => {
    set((state) => {
      state.selectedResultsView = view;
    });
  },
  setSelectedFilter: (filter: string) => {
    set((state) => {
      state.selectedFilter = filter;
    });
  },
  setGroupResultsBy: (groupBy: ResultGroup) => {
    set((state) => {
      state.groupResultsBy = groupBy;
    });
  },
  setSortResults: (sortColumns?: SortColumn[]) => {
    set((state) => {
      state.sortResults = sortColumns;
    });
  },
  setScansSearchText: (text: string) => {
    set((state) => {
      state.scansSearchText = text;
    });
  },
  setHighlightLabeled: (highlight: boolean) => {
    set((state) => {
      state.highlightLabeled = highlight;
    });
  },
  setSelectedResultRow: (row: number) => {
    set((state) => {
      state.selectedResultRow = row;
    });
  },
  setDataframeWrapText: (wrap: boolean) => {
    set((state) => {
      state.dataframeWrapText = wrap;
    });
  },
  setDataframeFilterColumns: (columns: string[]) => {
    set((state) => {
      state.dataframeFilterColumns = columns;
    });
  },
  setDataframeShowFilterColumns: (show: boolean) => {
    set((state) => {
      state.dataframeShowFilterColumns = show;
    });
  },
});
