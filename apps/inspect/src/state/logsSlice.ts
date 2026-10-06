import type { SamplesViewState } from "../app/samples/list/samplesView";
import {
  DisplayedSample,
  LogListGridState,
  LogsState,
  SamplesPanelGridState,
} from "../app/types";

import { StoreState } from "./store";

export interface LogsSlice {
  logs: LogsState;
  logsActions: {
    setSelectedRowIndex: (index: number | null) => void;

    /** Merge a partial grid-state update into the scope entry (created with
     *  an empty sort if missing). Merging (not replacing) means a write from
     *  one callback's snapshot can't clobber fields it didn't change —
     *  e.g. clearing filters must not drop the persisted row selection. */
    patchLogsGridState: (
      scope: string,
      partial: Partial<LogListGridState>
    ) => void;
    clearLogsGridState: (scope?: string) => void;
    setLogsColumnVisibility: (visibility: Record<string, boolean>) => void;

    // SamplesPanel scope only; logViewSamples goes through setSampleListView.
    /** Merge a partial grid-state update into the scope entry. Merging (not
     *  replacing) means a sorting write can't clobber filters written from a
     *  different callback's snapshot. */
    patchSamplesGridState: (
      scope: "samplesPanel",
      partial: Partial<SamplesPanelGridState>
    ) => void;
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
  listing: {
    columnVisibility: {},
    gridStateByScope: {},
  },
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
): LogsSlice => {
  const slice = {
    // State
    logs: initialState,

    // Actions
    logsActions: {
      patchSamplesGridState: (
        scope: "samplesPanel",
        partial: Partial<SamplesPanelGridState>
      ) => {
        set((state) => {
          Object.assign(state.logs.samplesListState.byScope[scope], partial);
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
      setSelectedRowIndex: (index: number | null) => {
        set((state) => {
          state.logs.listing.selectedRowIndex = index;
        });
      },
      patchLogsGridState: (
        scope: string,
        partial: Partial<LogListGridState>
      ) => {
        set((state) => {
          const entry = state.logs.listing.gridStateByScope[scope];
          if (entry) {
            Object.assign(entry, partial);
          } else {
            state.logs.listing.gridStateByScope[scope] = {
              sorting: [],
              ...partial,
            };
          }
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
    },
  } as const;

  return slice;
};

export const initializeLogsSlice = <T extends LogsSlice>(
  set: (fn: (state: T) => void) => void
) => {
  set((state) => {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!state.logs) {
      state.logs = initialState;
    }
    if ("selectedLogFile" in state.logs) delete state.logs.selectedLogFile;
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
