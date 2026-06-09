import { GridState } from "ag-grid-community";

import { EvalSet, LogHandle } from "@tsmono/inspect-common/types";
import { createLogger } from "@tsmono/util";

import type { SamplesViewState } from "../app/samples/list/samplesView";
import {
  deriveSingleFileLogDir,
  isSingleFileMode,
} from "../app/singleFileMode";
import { DisplayedSample, LogsState } from "../app/types";
import {
  ClientAPI,
  EvalHeader,
  LogDetails,
  LogPreview,
} from "../client/api/types";
import { DatabaseService } from "../client/database";
import { isUri, join } from "../utils/uri";

import { StoreState } from "./store";

const log = createLogger("Log Slice");

export interface LogsSlice {
  logs: LogsState;
  logsActions: {
    // Update State
    setLogDir: (logDir?: string) => void;
    setLogHandles: (logHandles: LogHandle[]) => void;

    updateLogPreviews: (previews: Record<string, LogPreview>) => void;
    syncLogPreviews: (logs: LogHandle[]) => Promise<void>;

    updateLogDetails: (details: Record<string, LogDetails>) => void;

    // Fetch or update logs
    initLogDir: () => Promise<string | undefined>;
    ensureReplication: () => Promise<void>;
    syncLogs: () => Promise<LogHandle[]>;

    setSelectedLogFile: (logFile: string) => void;
    clearSelectedLogFile: () => void;

    // Cross-file sample operations
    getAllCachedSamples: () => Promise<any[]>;
    queryCachedSamples: (filter?: {
      completed?: boolean;
      hasError?: boolean;
      scoreRange?: { min: number; max: number; scoreName?: string };
    }) => Promise<any[]>;

    // Try to fetch an eval-set
    syncEvalSetInfo: (logPath?: string) => Promise<EvalSet | undefined>;

    updateFlowData: (flowPath: string, flowData?: string) => void;

    setFilteredCount: (count: number) => void;
    setWatchedLogs: (logs: LogHandle[]) => void;
    clearWatchedLogs: () => void;
    setSelectedRowIndex: (index: number | null) => void;

    setLogsGridState: (scope: string, gridState: GridState) => void;
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
    setShowRetriedLogs: (showRetriedLogs: boolean) => void;
  };
}

const initialState: LogsState = {
  logDir: undefined,
  logs: [],
  logPreviews: {},
  logDetails: {},
  selectedLogFile: undefined as string | undefined,
  listing: {
    columnVisibility: {},
    gridStateByScope: {},
  },
  pendingRequests: new Map<string, Promise<EvalHeader | null>>(),
  dbStats: {
    logCount: 0,
    previewCount: 0,
    detailsCount: 0,
  },
  samplesListState: {
    byScope: {
      samplesPanel: { columnVisibility: {} },
    },
    byLog: {},
  },
  showRetriedLogs: false,
};

export const createLogsSlice = (
  set: (fn: (state: StoreState) => void) => void,
  get: () => StoreState,
  _store: any,
  api: ClientAPI
): [LogsSlice, () => void] => {
  const slice = {
    // State
    logs: initialState,

    // Actions
    logsActions: {
      setLogDir: (logDir?: string) => {
        set((state) => {
          const prev = state.logs.logDir;
          if (logDir === prev) return;
          state.logs.logDir = logDir;
          // Only wipe on real dir-to-dir transitions. undefined/"" are
          // initialization signals (two competing sources race during load
          // and rehydration) — wiping then would clobber the persisted sort.
          const realPrev = prev !== undefined && prev !== "";
          const realNew = logDir !== undefined && logDir !== "";
          if (realPrev && realNew) {
            state.logs.samplesListState.byScope.samplesPanel.gridState =
              undefined;
            // SampleList per-log state survives the dir change — each log
            // still owns its own bucket via `byLog[logFile]`. No need to
            // reset filters/sort here.
            // listing.gridStateByScope keys are old logDir paths.
            state.logs.listing.gridStateByScope = {};
          }
        });
      },
      setLogHandles: (logs: LogHandle[]) =>
        set((state) => {
          state.logs.logs = logs;
        }),
      syncLogPreviews: async (logs: LogHandle[]) => {
        const state = get();
        if (!state.replicationService) {
          console.error("Replication service not initialized in LogsStore");
          return;
        }
        try {
          await state.replicationService?.loadLogPreviews({ logs });
        } catch (e) {
          console.error("Failed to sync log previews", e);
        }
      },
      updateLogPreviews: (previews: Record<string, LogPreview>) =>
        set((state) => {
          state.logs.logPreviews = {
            ...get().logs.logPreviews,
            ...previews,
          };
        }),

      updateLogDetails: (details: Record<string, LogDetails>) =>
        set((state) => {
          state.logs.logDetails = {
            ...get().logs.logDetails,
            ...details,
          };
        }),
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
      initLogDir: async () => {
        const state = get();

        let logDir: string | undefined;
        let absLogDir: string | undefined;

        if (isSingleFileMode) {
          // No directory listing to fetch — derive the log dir from the
          // selected file. Re-deriving against the same file would just
          // produce the same answer, so short-circuit if it's already set.
          if (state.logs.logDir !== undefined) return state.logs.logDir;
          logDir = deriveSingleFileLogDir(state.logs.selectedLogFile);
          // For bare-basename deep links there's no dir to derive; fall back
          // to the server's configured log dir (cheap — no walk).
          if (logDir === undefined) {
            try {
              logDir = await api.get_log_dir();
            } catch (e) {
              console.log(e);
            }
          }
        } else {
          try {
            const root = await api.get_log_root();
            logDir = root.log_dir;
            absLogDir = root.abs_log_dir;
          } catch (e) {
            console.log(e);
            get().appActions.setLoading(false, e as Error);
            // Fall through with undefined to clear any stale state below.
          }
        }

        if (get().logs.logDir !== logDir) {
          get().logsActions.setLogDir(logDir);
        }
        if (get().logs.absLogDir !== absLogDir) {
          set((state) => {
            state.logs.absLogDir = absLogDir;
          });
        }
        return logDir;
      },
      ensureReplication: async () => {
        const state = get();
        if (state.logs.logDir) {
          await state.logsActions.syncLogs();
        }
      },
      syncLogs: async () => {
        const databaseService = get().databaseService;
        get().appActions.setLoading(true);

        // Determine the log directory
        const logDir = await get().logsActions.initLogDir();
        const databaseHandle = api.get_log_dir_handle(logDir);

        // Setup up the database service
        const initDatabase =
          !databaseService ||
          databaseService.getDatabaseHandle() !== databaseHandle;

        if (initDatabase) {
          // Initialize the database
          const initializeDatabase = async (
            logDir?: string
          ): Promise<DatabaseService | undefined> => {
            if (!logDir) {
              // No database service available
              return undefined;
            }

            try {
              const databaseService = get().databaseService;
              if (!databaseService) {
                return undefined;
              }
              await databaseService.openDatabase(databaseHandle);
              return databaseService;
            } catch (e) {
              console.log(e);
              get().appActions.setLoading(false, e as Error);
              return;
            }
          };

          // Don't enable syncing if there is no log directory.
          // initLogDir may have already called setLoading(false, e) via its own
          // catch block; the counter is clamped at zero so the extra decrement
          // here is safe, and we avoid overwriting a non-null error by only
          // calling setLoading(false) when no error was already recorded.
          if (!logDir || isSingleFileMode) {
            if (!get().app.status.error) {
              get().appActions.setLoading(false);
            }
            return [];
          }

          // Activate the database for this log directory
          const databaseService = await initializeDatabase(logDir);
          if (!databaseService) {
            // No database service available
            throw new Error("Database service not available");
          }

          // Activate replication for this database
          await get().replicationService?.startReplication(
            databaseService,
            api,
            {
              setLogHandles: (logs: LogHandle[]) => {
                const state = get();
                state.logsActions.setLogHandles(logs);
              },
              getSelectedLog: () => {
                const state = get();
                if (!state.logs.selectedLogFile) {
                  return undefined;
                }
                return state.logs.logs.find((handle) => {
                  return handle.name.endsWith(state.logs.selectedLogFile!);
                });
              },
              setSelectedLogFile: (logFile: string) => {
                const state = get();
                state.logsActions.setSelectedLogFile(logFile);
              },
              updateLogPreviews: (previews: Record<string, LogPreview>) => {
                const state = get();
                state.logsActions.updateLogPreviews(previews);
              },
              updateLogDetails: (details: Record<string, LogDetails>) => {
                const state = get();
                state.logsActions.updateLogDetails(details);
              },
              setLoading(loading: boolean) {
                const state = get();
                state.appActions.setLoading(loading);
              },
              setBackgroundSyncing(syncing: boolean) {
                set((state) => {
                  state.app.status.syncing = syncing;
                });
              },
              setDbStats(stats: {
                logCount: number;
                previewCount: number;
                detailsCount: number;
              }) {
                set((state) => {
                  state.logs.dbStats = stats;
                });
              },
            }
          );
        }

        get().appActions.setLoading(false);

        // Sync
        return (await get().replicationService?.sync(initDatabase)) || [];
      },
      syncEvalSetInfo: async (logPath?: string) => {
        const info = await api.get_eval_set(logPath);
        set((state) => {
          state.logs.evalSet = info;
        });
        return info;
      },
      updateFlowData: (flowPath: string, flowData?: string) => {
        set((state) => {
          state.logs.flowDir = flowPath;
          state.logs.flow = flowData;
        });
      },
      // Select a specific log file
      setSelectedLogFile: async (logFile: string) => {
        const state = get();
        const isInFileList =
          state.logs.logs.findIndex((val: { name: string }) =>
            val.name.endsWith(logFile)
          ) !== -1;

        if (!isInFileList) {
          if (state.replicationService?.isReplicating() && !isSingleFileMode) {
            await state.logsActions.syncLogs();
            const logHandle = get().logs.logs.find((val: { name: string }) =>
              val.name.endsWith(logFile)
            );
            if (!logHandle) {
              throw new Error(`Log file not found: ${logFile}`);
            }
          } else {
            state.logsActions.setLogHandles([{ name: logFile }]);
          }
        }
        set((state) => {
          const absoluteLogfile = isUri(logFile)
            ? logFile
            : join(logFile, state.logs.logDir);
          state.logs.selectedLogFile = absoluteLogfile;
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
      setLogsGridState: (scope: string, gridState: GridState) => {
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

      // Cross-file sample operations
      getAllCachedSamples: async () => {
        try {
          log.debug("LOADING ALL CACHED SAMPLES");
          const dbService = get().databaseService;
          if (!dbService) {
            throw new Error("Database service not initialized");
          }
          const samples = await dbService.readAllSampleSummaries();
          log.debug(`Retrieved ${samples.length} cached samples`);
          return samples;
        } catch (e) {
          log.debug("No cached samples available");
          return [];
        }
      },

      queryCachedSamples: async (filter?: {
        completed?: boolean;
        hasError?: boolean;
        scoreRange?: { min: number; max: number; scoreName?: string };
      }) => {
        try {
          log.debug("QUERYING CACHED SAMPLES", filter);
          const dbService = get().databaseService;
          if (!dbService) {
            throw new Error("Database service not initialized");
          }
          const samples = await dbService.querySampleSummaries(filter);
          log.debug(`Query returned ${samples.length} samples`);
          return samples;
        } catch (e) {
          log.debug("Sample query failed, returning empty results");
          return [];
        }
      },
      setShowRetriedLogs: (showRetriedLogs: boolean) => {
        set((state) => {
          state.logs.showRetriedLogs = showRetriedLogs;
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
    if (
      a[i].logFile !== b[i].logFile ||
      a[i].sampleId !== b[i].sampleId ||
      a[i].epoch !== b[i].epoch
    ) {
      return false;
    }
  }
  return true;
};
