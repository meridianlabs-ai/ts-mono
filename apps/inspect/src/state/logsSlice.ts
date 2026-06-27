import { GridState } from "ag-grid-community";

import { EvalSet, LogHandle } from "@tsmono/inspect-common/types";
import { createLogger } from "@tsmono/util";

import type { SamplesViewState } from "../app/samples/list/samplesView";
import { getLogDir, setLogDir } from "../app/server/useLogDir";
import {
  deriveSingleFileLogDir,
  isSingleFileMode,
} from "../app/singleFileMode";
import { DisplayedSample, LogListGridState, LogsState } from "../app/types";
import { ClientAPI, EvalHeader, SampleSummary } from "../client/api/types";
import { DatabaseService } from "../client/database";
import { isUri, join } from "../utils/uri";

import * as logsContent from "./logsContent";
import { StoreState } from "./store";
import {
  ApplicationContext,
  replicationService,
} from "./sync/replicationService";

const log = createLogger("Log Slice");

export interface LogsSlice {
  logs: LogsState;
  logsActions: {
    syncLogPreviews: (logs: LogHandle[]) => Promise<void>;

    // Fetch or update logs
    initLogDir: () => Promise<string | undefined>;
    activateReplication: (logDir: string) => Promise<void>;
    deactivateReplication: () => void;
    ensureReplication: () => Promise<void>;
    syncLogs: () => Promise<LogHandle[]>;

    setSelectedLogFile: (logFile: string) => void;
    clearSelectedLogFile: () => void;

    // Cross-file sample operations
    getAllCachedSamples: () => Promise<SampleSummary[]>;
    queryCachedSamples: (filter?: {
      completed?: boolean;
      hasError?: boolean;
      scoreRange?: { min: number; max: number; scoreName?: string };
    }) => Promise<SampleSummary[]>;

    // Try to fetch an eval-set
    syncEvalSetInfo: (logPath?: string) => Promise<EvalSet | undefined>;

    updateFlowData: (flowPath: string, flowData?: string) => void;

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
};

export const createLogsSlice = (
  set: (fn: (state: StoreState) => void) => void,
  get: () => StoreState,
  _store: unknown,
  api: ClientAPI
): [LogsSlice, () => void] => {
  // Open the per-dir IndexedDB for `logDir`. Returns the (already-constructed)
  // DatabaseService once its database is open, or undefined if unavailable.
  const openLogDirDatabase = async (
    logDir: string
  ): Promise<DatabaseService | undefined> => {
    const databaseService = get().databaseService;
    if (!databaseService) {
      return undefined;
    }
    try {
      await databaseService.openDatabase(api.get_log_dir_handle(logDir));
      return databaseService;
    } catch (e) {
      console.log(e);
      get().appActions.setLoading(false, e as Error);
      return undefined;
    }
  };

  // Build the replication context: the non-cache bridges to zustand UI state.
  // Log-list content writes go through the `logsContent` seam (IndexedDB +
  // react-query cache) inside the replicator itself, so they aren't here.
  const replicationContext = (): ApplicationContext => ({
    setLoading(loading: boolean) {
      get().appActions.setLoading(loading);
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
  });

  const slice = {
    // State
    logs: initialState,

    // Actions
    logsActions: {
      syncLogPreviews: async (logs: LogHandle[]) => {
        try {
          await replicationService.loadLogPreviews({ logs });
        } catch (e) {
          console.error("Failed to sync log previews", e);
        }
      },
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
      // Single-file mode only: derive the log dir from the selected file and
      // store it in zustand (where `useLogDir`/`getLogDir`'s single-file branch
      // reads it). In dir mode the log dir comes from the gated `["log-dir"]`
      // query, not here, so this is a no-op there.
      initLogDir: async () => {
        if (!isSingleFileMode) {
          return getLogDir();
        }

        // Re-deriving against the same file would just produce the same answer,
        // so short-circuit if it's already seeded.
        const existing = getLogDir();
        if (existing !== undefined) return existing;
        let logDir = deriveSingleFileLogDir(get().logs.selectedLogFile);
        // For bare-basename deep links there's no dir to derive; fall back
        // to the server's configured log dir (cheap — no walk).
        if (logDir === undefined) {
          try {
            logDir = await api.get_log_dir();
          } catch (e) {
            console.log(e);
          }
        }

        setLogDir(logDir);
        return logDir;
      },
      // Open the per-dir database and start dir-mode replication for `logDir`,
      // then run an initial sync. Owned by <ReplicationController>, which calls
      // this on mount (dir mode only). Idempotent: if replication is already
      // active for this dir's database, it just re-syncs.
      activateReplication: async (logDir: string) => {
        const databaseService = await openLogDirDatabase(logDir);
        if (!databaseService) {
          throw new Error("Database service not available");
        }

        await replicationService.startReplication(
          databaseService,
          api,
          logDir,
          replicationContext()
        );

        await replicationService.sync(true);
      },
      deactivateReplication: () => {
        replicationService.stopReplication();
      },
      // Re-sync the current dir-mode session (replication is activated by
      // <ReplicationController>). In single-file mode there's no dir listing to
      // sync, so this is a no-op beyond clearing the loading flag.
      ensureReplication: async () => {
        if (getLogDir()) {
          await get().logsActions.syncLogs();
        }
      },
      syncLogs: async () => {
        get().appActions.setLoading(true);

        const logDir = getLogDir();

        // No dir listing in single-file mode (or when no root is configured) —
        // nothing to replicate. Clear loading unless an error is already set.
        if (!logDir || isSingleFileMode) {
          if (!get().app.status.error) {
            get().appActions.setLoading(false);
          }
          return [];
        }

        // Ensure the per-dir DB is open and replication is active. The
        // controller normally does this on mount; re-do it here defensively so
        // a re-sync triggered before activation (or after a teardown) still
        // works. startReplication is idempotent.
        const databaseService = get().databaseService;
        const databaseHandle = api.get_log_dir_handle(logDir);
        const needsActivation =
          !replicationService.isReplicating() ||
          !databaseService ||
          databaseService.getDatabaseHandle() !== databaseHandle;

        if (needsActivation) {
          const opened = await openLogDirDatabase(logDir);
          if (!opened) {
            throw new Error("Database service not available");
          }
          await replicationService.startReplication(
            opened,
            api,
            logDir,
            replicationContext()
          );
        }

        get().appActions.setLoading(false);

        // Sync (show progress when we just (re)activated replication)
        return (await replicationService.sync(needsActivation)) || [];
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
        const logDir = getLogDir();
        const isInFileList =
          logsContent
            .getLogHandles(logDir)
            .findIndex((val) => val.name.endsWith(logFile)) !== -1;

        if (!isInFileList) {
          if (replicationService.isReplicating() && !isSingleFileMode) {
            await state.logsActions.syncLogs();
            const logHandle = logsContent
              .getLogHandles(getLogDir())
              .find((val) => val.name.endsWith(logFile));
            if (!logHandle) {
              throw new Error(`Log file not found: ${logFile}`);
            }
          } else {
            logsContent.setHandles(logDir, [{ name: logFile }]);
          }
        }
        set((state) => {
          const absoluteLogfile = isUri(logFile)
            ? logFile
            : join(logFile, getLogDir());
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
        } catch {
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
        } catch {
          log.debug("Sample query failed, returning empty results");
          return [];
        }
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
