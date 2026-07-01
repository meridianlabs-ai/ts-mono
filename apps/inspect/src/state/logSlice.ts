import { sampleHandlesEqual } from "../app/shared/sample";
import { FilterError, LogState, ScoreLabel } from "../app/types";
import { LogDetails, PendingSamples } from "../client/api/types";
import { kLogViewInfoTabId } from "../constants";

import { cleanupLogPolling, getLogPolling } from "./logPollingInstance";
import { StoreState } from "./store";

export interface LogSlice {
  log: LogState;
  logActions: {
    selectSample: (
      sampleId: string | number,
      epoch: number,
      logFile: string
    ) => void;
    clearSelectedSample: () => void;

    // React to a freshly loaded/refreshed log's details: reset derived
    // selection state. The details themselves live in the react-query
    // collection, not zustand.
    onLogDetailsLoaded: (details: LogDetails) => void;

    // Update pending sample information
    setPendingSampleSummaries: (samples: PendingSamples) => void;
    clearPendingSampleSummaries: () => void;

    // Set filter criteria
    setFilter: (filter: string) => void;

    // Set the filter error
    setFilterError: (error: FilterError) => void;

    // Clear the filter error
    clearFilterError: () => void;

    // Set score labels
    setSelectedScores: (scores: ScoreLabel[]) => void;

    // Set available scores
    setScores: (scores: ScoreLabel[]) => void;

    // Reset filter state to defaults
    resetFiltering: () => void;

    // Record the log whose details have been loaded. UI state only; the
    // loading IO lives in `state/logLoad.ts`.
    setLoadedLog: (logFileName: string) => void;

    // Poll the currently selected log
    pollLog: () => Promise<void>;

    // Clear the currently loaded log
    clearLog: () => void;

    setFilteredSampleCount: (count: number) => void;
    clearFilteredSampleCount: () => void;
  };
}

// Initial state
const initialState = {
  // Log state
  selectedSampleId: undefined,
  selectedSampleEpoch: undefined,
  pendingSampleSummaries: undefined,
  loadedLog: undefined,

  // Filter state
  filter: "",
  filterError: undefined,

  selectedScores: undefined,
  scores: undefined,
};

// Create the app slice using StoreState directly
export const createLogSlice = (
  set: (fn: (state: StoreState) => void) => void,
  get: () => StoreState,
  _store: unknown
): [LogSlice, () => void] => {
  const slice = {
    // State
    log: initialState,

    // Actions
    logActions: {
      selectSample: (
        sampleId: string | number,
        epoch: number,
        logFile: string
      ) => {
        // Ignore if already selected
        const currentSample = get().log.selectedSampleHandle;
        if (
          sampleHandlesEqual(currentSample, {
            id: sampleId,
            epoch,
            logFile,
          })
        ) {
          return;
        }

        set((state) => {
          state.log.selectedSampleHandle = { id: sampleId, epoch, logFile };
        });
      },
      clearSelectedSample: () => {
        set((state) => {
          state.log.selectedSampleHandle = undefined;
        });
      },
      onLogDetailsLoaded: (details: LogDetails) => {
        set((state) => {
          state.log.selectedScores = undefined;
        });

        if (
          details.status !== "started" &&
          details.sampleSummaries.length === 0
        ) {
          // If there are no samples, use the workspace tab id by default
          get().appActions.setWorkspaceTab(kLogViewInfoTabId);
        }
      },
      setPendingSampleSummaries: (pendingSampleSummaries: PendingSamples) => {
        set((state) => {
          state.log.pendingSampleSummaries = pendingSampleSummaries;
        });
      },
      clearPendingSampleSummaries: () => {
        set((state) => {
          state.log.pendingSampleSummaries = undefined;
        });
      },
      setFilter: (filter: string) =>
        set((state) => {
          state.log.filter = filter;
        }),
      setFilterError: (error: FilterError) =>
        set((state) => {
          state.log.filterError = error;
        }),
      clearFilterError: () => {
        set((state) => {
          state.log.filterError = undefined;
        });
      },
      setSelectedScores: (scores: ScoreLabel[]) =>
        set((state) => {
          state.log.selectedScores = scores;
        }),
      setScores: (scores: ScoreLabel[]) =>
        set((state) => {
          state.log.scores = scores;
        }),
      resetFiltering: () =>
        set((state) => {
          state.log.filter = "";
          state.log.filterError = undefined;
          state.log.selectedScores = state.log.scores?.slice(0, 1);
        }),

      setLoadedLog: (logFileName: string) => {
        set((state) => {
          state.log.loadedLog = logFileName;
        });
      },

      clearLog: () => {
        set((state) => {
          state.log.loadedLog = undefined;
        });
      },

      pollLog: () => {
        const currentLog = get().log.loadedLog;
        if (currentLog) {
          getLogPolling().startPolling(currentLog);
        }
        return Promise.resolve();
      },

      setFilteredSampleCount: (count: number) => {
        set((state) => {
          state.log.filteredSampleCount = count;
        });
      },
      clearFilteredSampleCount: () => {
        set((state) => {
          state.log.filteredSampleCount = undefined;
        });
      },
    },
  } as const;

  const cleanup = () => {
    cleanupLogPolling();
  };

  return [slice, cleanup];
};

// Initialize app slice with StoreState
export const initalializeLogSlice = (
  set: (fn: (state: StoreState) => void) => void
) => {
  set((state) => {
    if (!state.log) {
      state.log = initialState;
    }
  });
};
