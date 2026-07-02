import { GridState } from "ag-grid-community";

import { LogHandle } from "@tsmono/inspect-common/types";

import type { SamplesViewState } from "../app/samples/list/samplesView";
import { DisplayedSample, LogListGridState, LogsState } from "../app/types";
import { EvalHeader } from "../client/api/types";

import { StoreState } from "./store";

export interface LogsSlice {
  logs: LogsState;
  logsActions: {
    setSelectedLogFile: (logFile: string) => void;
    clearSelectedLogFile: () => void;

    setFilteredCount: (count: number) => void;
    setWatchedLogs: (logs: LogHandle[]) => void;
    clearWatchedLogs: () => void;
    setSelectedRowIndex: (index: number | null) => void;

    setLogsGridState: (scope: string, gridState: LogListGridState) => void;
    clearLogsGridState: (scope?: string) => void;
    setLogsColumnVisibility: (visibility: Record<string, boolean>) => void;

    // SamplesPanel scope only; logViewSamples flows through setSampleListView.
    setSamplesGridState: (scope: "samplesPanel", gridState: GridState) => void;
    clearSamplesGridState: (scope: "samplesPanel") => void;
    setSamplesColumnVisibility: (
      scope: "samplesPanel",
      visibility: Record<string, boolean>
    ) => void;

    /** Persist a TaskSamplesView descriptor for a specific log file. The
     *  log path is captured by the caller at hook level so a navigation
     *  that races a pending effect can't redirect the write to a
     *  different log's bucket. */
    setSampleListView: (logFile: string, view: SamplesViewState) => void;

    setDisplayedSamples: (samples: Array<DisplayedSample>) => void;
    clearDisplayedSamples: () => void;
    setPreviousSamplesPath: (path: string | undefined) => void;
  };
}

const initialState: LogsState = {
  selectedLogFile: undefined as string | undefined,
  listing: {
    columnVisibility: {},
    gridStateByScope: {},
  },
  pendingRequests: new Map<string, Promise<EvalHeader | null>>(),
  samplesListState: {
    byScope: {
      samplesPanel: { columnVisibility: {} },
    },
    byLog: {},
  },
};

export const createLogsSlice = (
  set: (fn: (state: StoreState) => void) => void,
  get: () => StoreState,
  _store: unknown
): [LogsSlice, () => void] => {
  const slice = {
    // State
    logs: initialState,

    // Actions
    logsActions: {
      setSamplesGridState: (
        scope: "samplesPanel",
        gridState: GridState | undefined
      ) => {
        set((state) => {
          state.logs.samplesListState.byScope[scope].gridState = gridState;
        });
      },
      clearSamplesGridState: (scope: "samplesPanel") => {
        set((state) => {
          state.logs.samplesListState.byScope[scope].gridState = undefined;
        });
      },
      setSampleListView: (logFile: string, view: SamplesViewState) => {
        set((state) => {
          state.logs.samplesListState.byLog[logFile] = view;
        });
      },
      setDisplayedSamples: (samples: Array<DisplayedSample>) => {
        const currentDisplaySamples =
          get().logs.samplesListState.displayedSamples;
        set((state) => {
          if (!displaySamplesEqual(currentDisplaySamples, samples)) {
            state.logs.samplesListState.displayedSamples = samples;
          }
        });
      },
      clearDisplayedSamples: () => {
        set((state) => {
          state.logs.samplesListState.displayedSamples = undefined;
        });
      },
      setSamplesColumnVisibility: (
        scope: "samplesPanel",
        visibility: Record<string, boolean>
      ) => {
        set((state) => {
          state.logs.samplesListState.byScope[scope].columnVisibility =
            visibility;
        });
      },
      setPreviousSamplesPath: (path: string | undefined) => {
        set((state) => {
          state.logs.samplesListState.previousSamplesPath = path;
        });
      },
      // Select a specific log file (pure UI state). Expects an already-absolute
      // path; callers absolutize via the selectLogFile action. Ensuring the file is
      // loadable happens in the loader layer (ensureSelectableLog), driven by
      // loadLog when the selection is opened.
      setSelectedLogFile: (logFile: string) => {
        set((state) => {
          state.logs.selectedLogFile = logFile;
        });
      },
      setFilteredCount: (count: number) => {
        set((state) => {
          state.logs.listing.filteredCount = count;
        });
      },
      setWatchedLogs: (logs: LogHandle[]) => {
        set((state) => {
          state.logs.listing.watchedLogs = logs;
        });
      },
      clearWatchedLogs: () => {
        set((state) => {
          state.logs.listing.watchedLogs = undefined;
        });
      },
      setSelectedRowIndex: (index: number | null) => {
        set((state) => {
          state.logs.listing.selectedRowIndex = index;
        });
      },
      setLogsGridState: (scope: string, gridState: LogListGridState) => {
        set((state) => {
          state.logs.listing.gridStateByScope[scope] = gridState;
        });
      },
      clearLogsGridState: (scope?: string) => {
        set((state) => {
          if (scope === undefined) {
            state.logs.listing.gridStateByScope = {};
          } else {
            delete state.logs.listing.gridStateByScope[scope];
          }
        });
      },
      setLogsColumnVisibility: (visibility: Record<string, boolean>) => {
        set((state) => {
          state.logs.listing.columnVisibility = visibility;
        });
      },
      clearSelectedLogFile: () => {
        set((state) => {
          state.logs.selectedLogFile = undefined;
        });
      },
    },
  } as const;

  const cleanup = () => {
    // Database cleanup is handled in the main store cleanup
  };

  return [slice, cleanup];
};

export const initializeLogsSlice = <T extends LogsSlice>(
  set: (fn: (state: T) => void) => void
) => {
  set((state) => {
    if (!state.logs) {
      state.logs = initialState;
    }
  });
};

const displaySamplesEqual = (
  a: DisplayedSample[] | undefined,
  b: DisplayedSample[] | undefined
): boolean => {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i++) {
    const sampleA = a[i];
    const sampleB = b[i];
    if (sampleA === undefined || sampleB === undefined) {
      return false;
    }
    if (
      sampleA.logFile !== sampleB.logFile ||
      sampleA.sampleId !== sampleB.sampleId ||
      sampleA.epoch !== sampleB.epoch
    ) {
      return false;
    }
  }
  return true;
};
