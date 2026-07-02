import { LogHandle } from "@tsmono/inspect-common/types";

import { getAppConfig } from "../app/appConfig";
import { getLogDir } from "../app/server/useLogDir";
import { ClientAPI } from "../client/api/types";
import { DatabaseService } from "../client/database";

import { getDatabaseService } from "./databaseServiceInstance";
import { fetchEngine } from "./fetchEngine";
import { createLogsContentSink } from "./logsContent";
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
    engineDir = logDir;
    replicationService.startReplication(requireApi(), fetchEngine);
  }
};

// The dir the engine was last started for (single-file mode has no database
// handle to compare against, e.g. across VS Code live navigation).
let engineDir: string | null = null;

// Coalesces concurrent activations — a controller mount and the first details
// query race into ensureFetchEngine.
let pendingActivation: { logDir: string; promise: Promise<void> } | null = null;

/**
 * Ensure the fetch engine is running for `logDir` — the mode-independent
 * activation entry point. Dir mode also opens the per-dir database and starts
 * the replication producer; single-file mode starts the engine alone (the
 * database stays unopened, so reads miss and writes are cache-only).
 */
export const ensureFetchEngine = (logDir: string): Promise<void> => {
  if (pendingActivation?.logDir === logDir) {
    return pendingActivation.promise;
  }
  const promise = (async () => {
    if (getAppConfig().singleFileMode) {
      if (!fetchEngine.isStarted() || engineDir !== logDir) {
        const database = getDatabaseService();
        await fetchEngine.start({
          api: requireApi(),
          database,
          sink: createLogsContentSink(database, logDir),
        });
        engineDir = logDir;
      }
    } else {
      await ensureActive(logDir);
    }
  })();
  pendingActivation = { logDir, promise };
  void promise.finally(() => {
    if (pendingActivation?.promise === promise) {
      pendingActivation = null;
    }
  });
  return promise;
};

export const deactivateReplication = (): void => {
  replicationService.stopReplication();
  fetchEngine.stop();
  engineDir = null;
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
  await ensureFetchEngine(logDir);
  return (await replicationService.sync()) ?? [];
};
