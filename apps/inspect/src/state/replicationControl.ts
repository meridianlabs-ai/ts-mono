import { LogHandle } from "@tsmono/inspect-common/types";

import { getAppConfig } from "../app/appConfig";
import { getLogDir } from "../app/server/useLogDir";
import { ClientAPI } from "../client/api/types";
import { DatabaseService } from "../client/database";

import { getDatabaseService } from "./databaseServiceInstance";
import { fetchEngine } from "./fetchEngine";
import { createLogsContentSink } from "./logsContent";
import { storeImplementation } from "./store";
import { replicationService } from "./sync/replicationService";

let injectedApi: ClientAPI | null = null;

/**
 * Records the api the replication singleton should use. Called from
 * initializeStore so the singleton stays consistent with the api the consumer
 * passed into the App tree.
 */
export function setReplicationApi(api: ClientAPI) {
  injectedApi = api;
}

const requireApi = (): ClientAPI => {
  if (!injectedApi) {
    throw new Error(
      "Replication api must be set via setReplicationApi before activating replication"
    );
  }
  return injectedApi;
};

const requireStore = () => {
  if (!storeImplementation) {
    throw new Error("Store must be initialized before activating replication");
  }
  return storeImplementation;
};

// Open the per-dir IndexedDB for `logDir`. Returns the (already-constructed)
// DatabaseService once its database is open, or undefined if unavailable.
export const openLogDirDatabase = async (
  logDir: string
): Promise<DatabaseService | undefined> => {
  const databaseService = getDatabaseService();
  if (!databaseService) {
    return undefined;
  }
  try {
    await databaseService.openDatabase(requireApi().get_log_dir_handle(logDir));
    return databaseService;
  } catch (e) {
    console.log(e);
    requireStore()
      .getState()
      .appActions.setLoading(false, e as Error);
    return undefined;
  }
};

// Ensure the per-dir database is open and the fetch engine + dir-mode
// replication are running for `logDir`, (re)activating if they aren't.
// Idempotent. This is the composition root for the engine: the database, api,
// and per-dir cache sink are wired here.
const ensureActive = async (logDir: string): Promise<void> => {
  const databaseService = getDatabaseService();
  const databaseHandle = requireApi().get_log_dir_handle(logDir);
  const needsActivation =
    !replicationService.isReplicating() ||
    !databaseService ||
    databaseService.getDatabaseHandle() !== databaseHandle;

  if (needsActivation) {
    const opened = await openLogDirDatabase(logDir);
    if (!opened) {
      throw new Error("Database service not available");
    }
    await fetchEngine.start({
      api: requireApi(),
      database: opened,
      sink: createLogsContentSink(opened, logDir),
    });
    replicationService.startReplication(requireApi(), fetchEngine);
  }
};

export const deactivateReplication = (): void => {
  replicationService.stopReplication();
  fetchEngine.stop();
};

/**
 * Load previews for the given logs into the cache. Best-effort: a failure is
 * logged and swallowed so a preview fetch can't wedge the listing. Lives here,
 * not in the zustand slice — preview loading is replication/IO orchestration,
 * not UI state.
 */
export const syncLogPreviews = async (logs: LogHandle[]): Promise<void> => {
  try {
    await fetchEngine.ensurePreviews(logs);
  } catch (e) {
    console.error("Failed to sync log previews", e);
  }
};

/**
 * Ensure dir-mode replication is active for `logDir` (defaulting to the resolved
 * dir), then sync. The single entry point for both `<ReplicationController>` on
 * mount (passes its keyed dir) and the re-sync triggers (no arg). No-op in
 * single-file mode / before a dir is resolved. Lives here, not in the zustand
 * slice — replication orchestration is control-layer logic, not UI state.
 */
export const syncLogs = async (
  logDir: string | undefined = getLogDir()
): Promise<LogHandle[]> => {
  if (!logDir || getAppConfig().singleFileMode) {
    return [];
  }
  await ensureActive(logDir);
  return (await replicationService.sync()) ?? [];
};
