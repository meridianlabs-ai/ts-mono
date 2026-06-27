import { createLogger } from "@tsmono/util";

import { getLogDir } from "../app/server/useLogDir";
import { sampleHandlesEqual } from "../app/shared/sample";
import { FilterError, LogState, ScoreLabel } from "../app/types";
import { ClientAPI, LogDetails, PendingSamples } from "../client/api/types";
import { toLogPreview } from "../client/utils/type-utils";
import { kLogViewInfoTabId } from "../constants";
import { isUri, join } from "../utils/uri";

import { getDatabaseService } from "./databaseServiceInstance";
import { createLogPolling } from "./logPolling";
import * as logsContent from "./logsContent";
import { StoreState } from "./store";

const log = createLogger("logSlice");

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

    // Load log
    syncLog: (logFileName: string) => Promise<void>;

    // Refresh the current log
    refreshLog: () => Promise<void>;

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
  _store: unknown,
  api: ClientAPI
): [LogSlice, () => void] => {
  const logPolling = createLogPolling(get, set, api);

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

      syncLog: async (logFileName: string) => {
        const state = get();

        // Ensure there is a log dir. Dir mode resolves it via the gated query;
        // single-file mode derives it on demand through initLogDir.
        let logDir = getLogDir();
        if (logDir === undefined) {
          logDir = await state.logsActions.initLogDir();
        }

        const logAbsPath = !isUri(logFileName)
          ? join(logFileName, logDir)
          : logFileName;

        log.debug(`Load log: ${logAbsPath}`);

        // Try reading the data in the database first
        const dbService = getDatabaseService();
        if (dbService && dbService.opened()) {
          try {
            const cachedInfo =
              await dbService.readLogDetailsForFile(logAbsPath);
            if (cachedInfo) {
              log.debug(`Using cached log info for: ${logAbsPath}`);

              const refreshLogDetails = async () => {
                const logDetails = await api.get_log_details(logAbsPath, false);
                if (get().logs.selectedLogFile === logAbsPath) {
                  state.logActions.onLogDetailsLoaded(logDetails);
                }
                logsContent
                  .writeDetail(
                    dbService,
                    logDir,
                    logsContent.resolveLogKey(logDir, logAbsPath),
                    logDetails
                  )
                  .catch(() => {
                    // Silently ignore cache errors
                  });
                // Repaint the listing preview from the fresh status: a log
                // cached as "started" may have since finished.
                logsContent.mergePreviews(logDir, {
                  [logFileName]: toLogPreview(logDetails),
                });
              };

              if (cachedInfo.status === "started") {
                // A cached running log is only provisional. Wait for a fresh
                // read so reopening details can't re-seed stale running state.
                await refreshLogDetails();
              } else {
                // Seed the details cache from the IndexedDB-cached row (it's
                // already persisted, so cache-only), then react to it.
                logsContent.mergeDetails(logDir, {
                  [logsContent.resolveLogKey(logDir, logAbsPath)]: cachedInfo,
                });
                state.logActions.onLogDetailsLoaded(cachedInfo);
                logsContent.mergePreviews(logDir, {
                  [logFileName]: toLogPreview(cachedInfo),
                });
                // Still fetch fresh data in background to update cache
                void refreshLogDetails().catch(() => {
                  // Silently ignore background refresh errors
                });
              }
              set((state) => {
                state.log.loadedLog = logFileName;
              });

              state.logActions.clearPendingSampleSummaries();
              logPolling.startPolling(logFileName);
              return;
            }
          } catch {
            // Cache read failed, continue with normal flow
          }
        }

        try {
          const logDetails = await api.get_log_details(logFileName, false);

          // Cache-first seam: the details land in the cache synchronously; the
          // IndexedDB write completes in the background (fire-and-forget).
          void logsContent
            .writeDetail(
              dbService,
              logDir,
              logsContent.resolveLogKey(logDir, logAbsPath),
              logDetails
            )
            .catch(() => {
              // Silently ignore cache errors
            });
          state.logActions.onLogDetailsLoaded(logDetails);

          // Push the updated header information up
          const header = {
            [logFileName]: toLogPreview(logDetails),
          };

          logsContent.mergePreviews(logDir, header);
          set((state) => {
            state.log.loadedLog = logFileName;
          });

          // Start polling for pending samples
          state.logActions.clearPendingSampleSummaries();
          logPolling.startPolling(logFileName);
        } catch (error) {
          log.error("Error loading log:", error);
          throw error;
        }
      },

      clearLog: () => {
        set((state) => {
          state.log.loadedLog = undefined;
        });
      },

      pollLog: () => {
        const currentLog = get().log.loadedLog;
        if (currentLog) {
          logPolling.startPolling(currentLog);
        }
        return Promise.resolve();
      },

      refreshLog: async () => {
        const state = get();
        const selectedLogFile = state.logs.selectedLogFile;

        if (!selectedLogFile) {
          return;
        }

        log.debug(`refresh: ${selectedLogFile}`);
        try {
          const logDetails = await api.get_log_details(selectedLogFile, false);
          const logDir = getLogDir();
          void logsContent
            .writeDetail(
              getDatabaseService(),
              logDir,
              logsContent.resolveLogKey(logDir, selectedLogFile),
              logDetails
            )
            .catch(() => {
              // Silently ignore cache errors
            });
          state.logActions.onLogDetailsLoaded(logDetails);
        } catch (error) {
          log.error("Error refreshing log:", error);
          throw error;
        }
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
    logPolling.cleanup();
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
