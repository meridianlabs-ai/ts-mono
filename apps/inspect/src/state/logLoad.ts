import { createLogger } from "@tsmono/util";

import { getAppConfig } from "../app/appConfig";
import { getLogDir } from "../app/server/useLogDir";
import { toLogPreview } from "../client/utils/type-utils";
import { isUri, join } from "../utils/uri";

import { getDatabaseService } from "./databaseServiceInstance";
import { getLogPolling } from "./logPollingInstance";
import * as logsContent from "./logsContent";
import { syncLogs } from "./replicationControl";
import { storeImplementation } from "./store";
import { replicationService } from "./sync/replicationService";

const log = createLogger("logLoad");

const requireStore = () => {
  if (!storeImplementation) {
    throw new Error("Store must be initialized before loading a log");
  }
  return storeImplementation;
};

/**
 * Ensure `logFile` has a handle in the listing so its details can be loaded.
 * If it's already known, no-op. Otherwise, in dir mode (replication running) a
 * sync is triggered to discover it; a single-file / direct session seeds a
 * one-off handle from the resolved dir. Replication only runs in dir mode, so
 * `isReplicating()` already implies non-single-file — no `singleFileMode` check
 * is needed. Called by `loadLog` before fetching details.
 */
export const ensureSelectableLog = async (logFile: string): Promise<void> => {
  const logDir = getLogDir();
  const isInFileList =
    logsContent
      .getLogHandles(logDir)
      .findIndex((val) => val.name.endsWith(logFile)) !== -1;

  if (isInFileList) {
    return;
  }

  if (replicationService.isReplicating()) {
    await syncLogs();
    const logHandle = logsContent
      .getLogHandles(getLogDir())
      .find((val) => val.name.endsWith(logFile));
    if (!logHandle) {
      throw new Error(`Log file not found: ${logFile}`);
    }
  } else if (logDir !== undefined) {
    logsContent.setHandles(logDir, [{ name: logFile }]);
  }
};

/**
 * Load a single log's details into the cache and start polling it. Pure IO /
 * orchestration: the DB read, `get_log_details`, the `logsContent.merge*`
 * cache writes and starting the log-polling singleton all live here, out of the
 * zustand slice. UI-state writes (selection, `loadedLog`) stay in `logSlice`,
 * driven through its action setters. `LogLoadController` calls this on selection.
 */
export const loadLog = async (logFileName: string): Promise<void> => {
  const store = requireStore();
  const { logActions } = store.getState();
  const api = getAppConfig().api;

  // Make sure the file is discoverable in the listing before loading it (the
  // select→load flow used to ensure this in setSelectedLogFile).
  await ensureSelectableLog(logFileName);

  // Both loader hosts settle the log dir before any log view mounts, so
  // it's resolved by the time a log is opened.
  const logDir = getLogDir();
  if (logDir === undefined) {
    throw new Error("Cannot open a log before the log dir is resolved.");
  }

  const logAbsPath = !isUri(logFileName)
    ? join(logFileName, logDir)
    : logFileName;

  log.debug(`Load log: ${logAbsPath}`);

  // Try reading the data in the database first
  const dbService = getDatabaseService();
  if (dbService && dbService.opened()) {
    try {
      const cachedInfo = await dbService.readLogDetailsForFile(logAbsPath);
      if (cachedInfo) {
        log.debug(`Using cached log info for: ${logAbsPath}`);

        const refreshLogDetails = async () => {
          const logDetails = await api.get_log_details(logAbsPath, false);
          if (store.getState().logs.selectedLogFile === logAbsPath) {
            logActions.onLogDetailsLoaded(logDetails);
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
          logActions.onLogDetailsLoaded(cachedInfo);
          logsContent.mergePreviews(logDir, {
            [logFileName]: toLogPreview(cachedInfo),
          });
          // Still fetch fresh data in background to update cache
          void refreshLogDetails().catch(() => {
            // Silently ignore background refresh errors
          });
        }
        logActions.setLoadedLog(logFileName);

        logActions.clearPendingSampleSummaries();
        getLogPolling().startPolling(logFileName);
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
    logActions.onLogDetailsLoaded(logDetails);

    // Push the updated header information up
    logsContent.mergePreviews(logDir, {
      [logFileName]: toLogPreview(logDetails),
    });
    logActions.setLoadedLog(logFileName);

    // Start polling for pending samples
    logActions.clearPendingSampleSummaries();
    getLogPolling().startPolling(logFileName);
  } catch (error) {
    log.error("Error loading log:", error);
    throw error;
  }
};
