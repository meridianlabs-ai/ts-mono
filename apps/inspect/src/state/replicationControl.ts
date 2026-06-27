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

// Open the per-dir database and start dir-mode replication for `logDir`, then
// run an initial sync. Owned by <ReplicationController>, which calls this on
// mount (dir mode only). Idempotent: if replication is already active for this
// dir's database, it just re-syncs.
export const activateReplication = async (logDir: string): Promise<void> => {
  const databaseService = await openLogDirDatabase(logDir);
  if (!databaseService) {
    throw new Error("Database service not available");
  }

  await replicationService.startReplication(
    databaseService,
    requireApi(),
    logDir,
    replicationContext()
  );

  await replicationService.sync(true);
};

export const deactivateReplication = (): void => {
  replicationService.stopReplication();
};
