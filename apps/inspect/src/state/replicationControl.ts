import { LogHandle } from "@tsmono/inspect-common/types";

import { getAppConfig } from "../app/appConfig";
import { getLogDir } from "../app/server/useLogDir";
import { ClientAPI } from "../client/api/types";
import { DatabaseService } from "../client/database";

import { getDatabaseService } from "./databaseServiceInstance";
import { storeImplementation } from "./store";
import {
  ApplicationContext,
  replicationService,
} from "./sync/replicationService";

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
// Shared with logsSlice.syncLogs's defensive re-activation.
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

// Build the replication context: the non-cache bridges to zustand UI state.
// Log-list content writes go through the `logsContent` seam (IndexedDB +
// react-query cache) inside the replicator itself, so they aren't here.
export const replicationContext = (): ApplicationContext => ({
  setLoading(loading: boolean) {
    requireStore().getState().appActions.setLoading(loading);
  },
  setBackgroundSyncing(syncing: boolean) {
    requireStore().getState().appActions.setSyncing(syncing);
  },
  setDbStats(stats: {
    logCount: number;
    previewCount: number;
    detailsCount: number;
  }) {
    requireStore().getState().logsActions.setDbStats(stats);
  },
});

// Ensure the per-dir database is open and dir-mode replication is running for
// `logDir`, (re)activating if it isn't. Idempotent. Returns whether it had to
// (re)activate — used to decide whether the ensuing sync shows progress.
const ensureActive = async (logDir: string): Promise<boolean> => {
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
    await replicationService.startReplication(
      opened,
      requireApi(),
      logDir,
      replicationContext()
    );
  }
  return needsActivation;
};

// Activate + initial sync for `logDir`. Owned by <ReplicationController>, which
// calls this on mount (dir mode only).
export const activateReplication = async (logDir: string): Promise<void> => {
  await ensureActive(logDir);
  await replicationService.sync(true);
};

export const deactivateReplication = (): void => {
  replicationService.stopReplication();
};

/**
 * Re-sync the current dir-mode session: defensively ensure replication is active
 * for the resolved logDir (<ReplicationController> normally activated it on
 * mount), then sync. No-op in single-file mode / before a dir is resolved. Lives
 * here, not in the zustand slice — replication orchestration is control-layer
 * logic, not UI state. The `singleFileMode` read uses the sanctioned non-react
 * accessor; its sole single-file-reachable caller is <App>'s host-message bridge.
 */
export const syncLogs = async (): Promise<LogHandle[]> => {
  const store = requireStore();
  store.getState().appActions.setLoading(true);

  const logDir = getLogDir();
  if (!logDir || getAppConfig().singleFileMode) {
    if (!store.getState().app.status.error) {
      store.getState().appActions.setLoading(false);
    }
    return [];
  }

  const needsActivation = await ensureActive(logDir);
  store.getState().appActions.setLoading(false);

  return (await replicationService.sync(needsActivation)) ?? [];
};
