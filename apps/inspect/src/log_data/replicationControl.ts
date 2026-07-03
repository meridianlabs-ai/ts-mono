import { LogHandle } from "@tsmono/inspect-common/types";

import { getAppConfig, getLogDir } from "../app_config";
import { ClientAPI, LogDetails } from "../client/api/types";
import { DatabaseService } from "../client/database";

import {
  getDatabaseService,
  initDatabaseService,
} from "./databaseServiceInstance";
import { fetchEngine } from "./fetchEngine";
import { createLogsContentSink } from "./logsContent";
import { replicationService } from "./replicationService";

let injectedApi: ClientAPI | null = null;

/**
 * Wire the subsystem's dependencies: the api its backend reads go through
 * (kept consistent with the api the consumer passed into the App tree) and
 * the database-service singleton. The subsystem's *initialize* verb, called
 * once from the composition root (`initializeStore`); activation itself is
 * on-demand inside the acquisition entry points.
 */
export function initLogData(api: ClientAPI) {
  injectedApi = api;
  initDatabaseService();
}

const requireApi = (): ClientAPI => {
  if (!injectedApi) {
    throw new Error(
      "Log-data api must be set via initLogData before activating replication"
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

// Coalesces concurrent activations — a listing sync and the first details
// fetch race into ensureFetchEngine.
let pendingActivation: { logDir: string; promise: Promise<void> } | null = null;

/**
 * Ensure the fetch engine is running for `logDir` — the mode-independent
 * activation entry point, called on demand by every acquisition path
 * (`syncLogs`, `fetchLog`). Dir mode also opens the per-dir database and
 * starts the replication producer; single-file mode starts the engine alone
 * (the database stays unopened, so reads miss and writes are cache-only).
 * An ensure for a new dir tears the old activation down first (engine
 * `start()` self-stops; the database and replication producer re-point).
 */
const ensureFetchEngine = (logDir: string): Promise<void> => {
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

/**
 * Fetch a log's details at user priority, activating the engine for `logDir`
 * on demand first (a deep link's first fetch can run before any listing
 * subscriber has activated).
 */
export const fetchLog = async (
  logDir: string,
  logFile: string
): Promise<LogDetails> => {
  await ensureFetchEngine(logDir);
  return fetchEngine.fetch(logFile, "user");
};

/**
 * Ensure dir-mode replication is active for `logDir` (defaulting to the
 * resolved dir), then sync. The queryFn behind `useLogsSync` — listing
 * freshness is driven by its subscribers. No-op in single-file mode / before
 * a dir is resolved. Lives here, not in the zustand slice — replication
 * orchestration is control-layer logic, not UI state.
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
