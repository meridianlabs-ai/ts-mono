import {
  ColumnSizingState,
  RowSelectionState,
  SortingState,
} from "@tanstack/react-table";
import { createContext, useContext } from "react";
import { create, type StateCreator } from "zustand";
import { createJSONStorage, devtools, persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

import type { ColumnFilter } from "@tsmono/inspect-components/columnFilter";
import {
  createInitialSearchPanelState,
  normalizeSearchPanelState,
  type SearchPanelState,
} from "@tsmono/inspect-components/transcript-search";
import { debounce, getOwn, isRecord } from "@tsmono/util";

import { ScoutApiV2 } from "../api/api";
import { ColumnSizingStrategyKey } from "../app/components/columnSizing";
import type { ScanColumnKey } from "../app/scans/columns";
import { ResultGroup, ScanResultSummary, SortColumn } from "../app/types";
import { TranscriptInfo } from "../types/api-types";

import { createAppSlice, type AppSlice } from "./appSlice";
import { emptyDataframeState, type DataframeState } from "./dataframeState";
import { createRoutingSlice, type RoutingSlice } from "./routingSlice";

export type {
  ColumnFilter,
  FilterType,
} from "@tsmono/inspect-components/columnFilter";

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

interface TranscriptState {
  excludedTypes?: string[];
  collapsed?: boolean;
  outlineCollapsed?: boolean;
  displayMode?: "rendered" | "raw";
  validationSidebarCollapsed?: boolean;
}

export interface StoreState extends AppSlice, RoutingSlice {
  // Scans
  visibleScanJobCount?: number;

  // Scanner
  visibleScannerResults: ScanResultSummary[];
  visibleScannerResultsCount: number;

  // Dataframes
  selectedScanResult?: string;
  displayedScanResult?: string;

  // general UI state
  properties: Record<string, Record<string, unknown> | undefined>;
  gridStates: Record<string, DataframeState>;

  // Scan specific properties (clear when switching scans)
  selectedResultsTab?: string;
  selectedResultTab?: string;
  selectedScanner?: string;
  selectedResultsView?: string;
  selectedFilter?: string;
  showingRefPopover?: string;
  groupResultsBy?: ResultGroup;
  sortResults?: SortColumn[];
  scansSearchText?: string;
  highlightLabeled?: boolean;
  selectedResultRow?: number;
  dataframeWrapText?: boolean;
  dataframeShowFilterColumns?: boolean;
  dataframeFilterColumns?: string[];

  // Transcript
  transcriptCollapsedEvents: Record<string, Record<string, boolean>>;
  transcriptOutlineId?: string;
  searchPanelStates: Record<string, SearchPanelState | undefined>;

  // Transcript Detail properties (clear when switching transcripts)
  selectedTranscriptTab?: string;

  // Transcript Data (loaded data + source directory)
  transcriptsDir?: string;
  transcriptsTableState: TranscriptsTableState;

  // Scans table state
  scansTableState: ScansTableState;

  // Transcript Detail Data
  transcriptState: TranscriptState;

  // Validation state
  selectedValidationSetUri?: string;
  validationCaseSelection: Record<string, boolean>;
  validationSplitFilter?: string;
  validationSearchText?: string;

  // validationEditorState
  editorSelectedValidationSetUri?: string;

  // List of scans
  setVisibleScanJobCount: (count: number) => void;

  // Track the select result and data
  setSelectedScanner: (scanner: string) => void;
  setSelectedScanResult: (result: string) => void;
  setDisplayedScanResult: (result: string | undefined) => void;
  setVisibleScannerResults: (results: ScanResultSummary[]) => void;
  setVisibleScannerResultsCount: (count: number) => void;

  // Clearing state
  clearScanState: () => void;
  clearScansState: () => void;
  clearTranscriptState: () => void;

  setPropertyValue: (id: string, propertyName: string, value: unknown) => void;
  // Persisted component state: what was stored is whatever a component put
  // there, so it comes back as `unknown` for the caller to narrow.
  getPropertyValue: (
    id: string,
    propertyName: string,
    defaultValue?: unknown
  ) => unknown;
  removePropertyValue: (id: string, propertyName: string) => void;
  removeAllProperties: (id: string) => void;
  removeByPrefix: (id: string, prefix: string) => void;

  setGridState: (
    name: string,
    state: DataframeState | ((previous: DataframeState) => DataframeState)
  ) => void;
  clearGridState: (name: string) => void;

  setSelectedResultsTab: (tab: string) => void;
  setSelectedResultTab: (tab: string) => void;

  setTranscriptOutlineId: (id: string) => void;
  clearTranscriptOutlineId: () => void;

  setSelectedTranscriptTab: (tab: string) => void;
  setSearchPanelState: (
    key: string,
    updater: SearchPanelState | ((prev: SearchPanelState) => SearchPanelState)
  ) => void;
  clearSearchPanelState: (key: string) => void;

  setTranscriptCollapsedEvent: (
    scope: string,
    event: string,
    collapsed: boolean
  ) => void;
  setTranscriptCollapsedEvents: (
    scope: string,
    events: Record<string, boolean>
  ) => void;
  clearTranscriptCollapsedEvents: (scope: string) => void;

  setSelectedResultsView: (view: string) => void;

  setSelectedFilter: (filter: string) => void;
  setShowingRefPopover: (popoverKey: string) => void;
  clearShowingRefPopover: () => void;
  setGroupResultsBy: (groupBy: ResultGroup) => void;
  setSortResults: (sortColumns?: SortColumn[]) => void;
  setScansSearchText: (text: string) => void;
  setHighlightLabeled: (highlight: boolean) => void;
  setSelectedResultRow: (row: number) => void;
  setDataframeWrapText: (wrap: boolean) => void;
  setDataframeFilterColumns: (columns: string[]) => void;
  setDataframeShowFilterColumns: (show: boolean) => void;

  setTranscriptsDir: (path: string) => void;
  setTranscriptsTableState: (
    updater:
      | TranscriptsTableState
      | ((prev: TranscriptsTableState) => TranscriptsTableState)
  ) => void;
  setTranscriptState: (
    updater: TranscriptState | ((prev: TranscriptState) => TranscriptState)
  ) => void;
  setScansTableState: (
    updater: ScansTableState | ((prev: ScansTableState) => ScansTableState)
  ) => void;

  // Validation actions
  setSelectedValidationSetUri: (uri: string | undefined) => void;
  setValidationCaseSelection: (selection: Record<string, boolean>) => void;
  toggleValidationCaseSelection: (caseId: string) => void;
  setValidationSplitFilter: (split: string | undefined) => void;
  setValidationSearchText: (text: string | undefined) => void;
  clearValidationState: () => void;

  setEditorSelectedValidationSetUri: (uri: string | undefined) => void;
}

// Slices are written against the full store so cross-slice actions (the
// "clear when switching X" resets) can reach every field with the composed
// set/get; the mutator tuple mirrors the middleware chain in createStore.
export type StoreSlice<T> = StateCreator<
  StoreState,
  [
    ["zustand/devtools", never],
    ["zustand/persist", unknown],
    ["zustand/immer", never],
  ],
  [],
  T
>;

const createDebouncedPersistStorage = (
  storage: ReturnType<typeof createJSONStorage>,
  delay = 2000
) => {
  if (!storage) {
    throw new Error("Storage is required");
  }

  type StorageValue = Parameters<typeof storage.setItem>[1];

  const debouncedSetItem = debounce((key: string, value: StorageValue) => {
    storage.setItem(key, value);
  }, delay);

  return {
    ...storage,
    setItem: (key: string, value: StorageValue) => {
      debouncedSetItem(key, value);
    },
  };
};

// Persisted buckets that no longer exist in the store. Stored blobs from
// older sessions still carry them; the shallow default merge would copy them
// back into state (and partialize would re-persist them forever).
const kRetiredPersistedKeys = [
  "listPositions",
  "loading",
  "loadingData",
  "resultDataInState",
  "resultsStoredInRef",
  "scrollPositions",
  "transcripts",
  "visibleRanges",
];

const mergePersistedState = (
  persisted: unknown,
  current: StoreState
): StoreState => {
  if (!isRecord(persisted)) return current;
  const retained = { ...persisted };
  for (const key of kRetiredPersistedKeys) delete retained[key];
  return { ...current, ...retained };
};

export const createStore = (api: ScoutApiV2) =>
  create<StoreState>()(
    devtools(
      persist(
        immer((set, get, store) => ({
          ...createAppSlice(set, get, store),
          ...createRoutingSlice(set, get, store),

          // Initial state
          properties: {},
          gridStates: {},
          transcriptCollapsedEvents: {},
          searchPanelStates: {},
          visibleScannerResults: [],
          visibleScannerResultsCount: 0,
          highlightLabeled: false,
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
          transcriptState: {},
          validationCaseSelection: {},

          // Actions
          setVisibleScanJobCount: (count: number) =>
            set((state) => {
              state.visibleScanJobCount = count;
            }),
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
          clearTranscriptState: () => {
            set((state) => {
              state.selectedTranscriptTab = undefined;
              state.searchPanelStates = {};
            });
          },
          setPropertyValue(id: string, propertyName: string, value: unknown) {
            set((state) => {
              const group = getOwn(state.properties, id);
              if (group !== undefined && propertyName !== "__proto__") {
                group[propertyName] = value;
                return;
              }
              // Computed keys bypass the inherited __proto__ setter, which
              // Immer rejects even when the draft already owns that property.
              const next = { ...group, [propertyName]: value };
              if (id === "__proto__") {
                state.properties = { ...state.properties, [id]: next };
              } else {
                state.properties[id] = next;
              }
            });
          },
          getPropertyValue(
            id: string,
            propertyName: string,
            defaultValue: unknown
          ): unknown {
            const group = getOwn(get().properties, id);
            const value =
              group !== undefined && Object.hasOwn(group, propertyName)
                ? group[propertyName]
                : undefined;
            return value !== undefined ? value : defaultValue;
          },
          removePropertyValue(id: string, propertyName: string) {
            set((state) => {
              const propertyGroup = getOwn(state.properties, id);

              if (
                !propertyGroup ||
                !Object.hasOwn(propertyGroup, propertyName)
              ) {
                return;
              }

              delete propertyGroup[propertyName];
              if (Object.keys(propertyGroup).length === 0) {
                delete state.properties[id];
              }
            });
          },
          removeAllProperties(id: string) {
            set((state) => {
              delete state.properties[id];
            });
          },
          removeByPrefix(id: string, prefix: string) {
            set((state) => {
              const bag = getOwn(state.properties, id);
              if (!bag) return;
              let changed = false;
              for (const key of Object.keys(bag)) {
                if (key.startsWith(prefix)) {
                  delete bag[key];
                  changed = true;
                }
              }
              if (changed && Object.keys(bag).length === 0) {
                delete state.properties[id];
              }
            });
          },
          setGridState: (name, gridState) => {
            set((state) => {
              state.gridStates[name] =
                typeof gridState === "function"
                  ? gridState(state.gridStates[name] ?? emptyDataframeState)
                  : gridState;
            });
          },
          clearGridState: (name: string) => {
            set((state) => {
              const newGridStates = { ...state.gridStates };
              // TODO: Revisit

              delete newGridStates[name];

              return {
                ...state,
                gridStates: newGridStates,
              };
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
          setTranscriptOutlineId: (id: string) => {
            set((state) => {
              state.transcriptOutlineId = id;
            });
          },
          clearTranscriptOutlineId: () => {
            set((state) => {
              state.transcriptOutlineId = undefined;
            });
          },
          setSelectedTranscriptTab: (tab: string) => {
            set((state) => {
              state.selectedTranscriptTab = tab;
            });
          },
          setSearchPanelState: (key, updater) => {
            set((state) => {
              const prev = normalizeSearchPanelState(
                state.searchPanelStates[key] ?? createInitialSearchPanelState()
              );
              state.searchPanelStates[key] =
                typeof updater === "function" ? updater(prev) : updater;
            });
          },
          clearSearchPanelState: (key: string) => {
            set((state) => {
              const { [key]: _removed, ...remaining } = state.searchPanelStates;
              state.searchPanelStates = remaining;
            });
          },
          setTranscriptCollapsedEvent: (
            scope: string,
            event: string,
            collapsed: boolean
          ) => {
            set((state) => {
              if (!state.transcriptCollapsedEvents[scope]) {
                state.transcriptCollapsedEvents[scope] = {};
              }
              state.transcriptCollapsedEvents[scope][event] = collapsed;
            });
          },
          setTranscriptCollapsedEvents: (
            scope: string,
            events: Record<string, boolean>
          ) => {
            set((state) => {
              state.transcriptCollapsedEvents[scope] = events;
            });
          },
          clearTranscriptCollapsedEvents: (scope: string) => {
            set((state) => {
              state.transcriptCollapsedEvents[scope] = {};
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
          setShowingRefPopover: (popoverKey: string) => {
            set((state) => {
              state.showingRefPopover = popoverKey;
            });
          },
          clearShowingRefPopover: () => {
            set((state) => {
              state.showingRefPopover = undefined;
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
          setTranscriptState(updater) {
            set((state) => {
              state.transcriptState =
                typeof updater === "function"
                  ? updater(state.transcriptState)
                  : updater;
            });
          },
          setScansTableState(updater) {
            set((state) => {
              state.scansTableState =
                typeof updater === "function"
                  ? updater(state.scansTableState)
                  : updater;
            });
          },

          // Validation actions
          setSelectedValidationSetUri: (uri: string | undefined) => {
            set((state) => {
              state.selectedValidationSetUri = uri;
              // Clear case selection when switching validation sets
              state.validationCaseSelection = {};
            });
          },
          setValidationCaseSelection: (selection: Record<string, boolean>) => {
            set((state) => {
              state.validationCaseSelection = selection;
            });
          },
          toggleValidationCaseSelection: (caseId: string) => {
            set((state) => {
              const current = state.validationCaseSelection[caseId] ?? false;
              state.validationCaseSelection[caseId] = !current;
            });
          },
          setValidationSplitFilter: (split: string | undefined) => {
            set((state) => {
              state.validationSplitFilter = split;
            });
          },
          setValidationSearchText: (text: string | undefined) => {
            set((state) => {
              state.validationSearchText = text;
            });
          },
          clearValidationState: () => {
            set((state) => {
              state.selectedValidationSetUri = undefined;
              state.validationCaseSelection = {};
              state.validationSplitFilter = undefined;
              state.validationSearchText = undefined;
            });
          },
          setEditorSelectedValidationSetUri: (uri: string | undefined) => {
            set((state) => {
              state.editorSelectedValidationSetUri = uri;
            });
          },
        })),
        {
          name: "inspect-scout-storage",
          storage: createDebouncedPersistStorage(
            createJSONStorage(() => api.storage)
          ),
          version: 1,
          partialize: (state) => {
            const {
              hasInitializedRouting,
              visibleScannerResults,
              ...persistedState
            } = state;
            return persistedState;
          },
          merge: mergePersistedState,
        }
      )
    )
  );

type StoreApi = ReturnType<typeof createStore>;

const StoreContext = createContext<StoreApi | null>(null);
const ApiContext = createContext<ScoutApiV2 | null>(null);

export const StoreProvider = StoreContext.Provider;
export const ApiProvider = ApiContext.Provider;

const selectWholeState = (state: StoreState) => state;

export function useStore(): StoreState;
export function useStore<T>(selector: (state: StoreState) => T): T;
export function useStore<T>(selector?: (state: StoreState) => T) {
  // Named `use*` so React Compiler recognizes the call below as a hook. Under
  // any other name it treats `store(selector)` as a plain call and memoizes it
  // away, skipping zustand's useSyncExternalStore on later renders.
  const useBoundStore = useContext(StoreContext);
  if (!useBoundStore)
    throw new Error("useStore must be used within StoreProvider");

  return useBoundStore<T | StoreState>(selector ?? selectWholeState);
}

export const useApi = (): ScoutApiV2 => {
  const api = useContext(ApiContext);
  if (!api) throw new Error("useApi must be used within ApiProvider");
  return api;
};
