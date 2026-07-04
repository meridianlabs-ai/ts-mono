import { LogHandle } from "@tsmono/inspect-common/types";

import { getApi, getAppConfig, getLogDir } from "../app_config";
import { LogDetails } from "../client/api/types";
import { DatabaseService } from "../client/database";

import { getDatabaseService } from "./databaseServiceInstance";
import { fetchEngine, FetchPriority } from "./fetchEngine";
import { syncListing } from "./listingSync";
import { createLogsContentSink } from "./logsContent";

// Open the per-dir IndexedDB for `logDir`. Returns the (already-constructed)
// DatabaseService once its database is open, or undefined if unavailable.
export const openLogDirDatabase = async (
  logDir: string
): Promise<DatabaseService | undefined> => {
  const databaseService = getDatabaseService();
  try {
    await databaseService.openDatabase(getApi().get_log_dir_handle(logDir));
    return databaseService;
  } catch (e) {
    console.log(e);
    return undefined;
  }
};

// Ensure the per-dir database is open and the fetch engine is running for
// `logDir`, (re)activating if they aren't. Idempotent. This is the
// composition root for the engine: the database, api, and per-dir cache sink
// are wired here.
const ensureActive = async (logDir: string): Promise<void> => {
  const databaseHandle = getApi().get_log_dir_handle(logDir);
  const needsActivation =
    !fetchEngine.isStarted() ||
    engineDir !== logDir ||
    getDatabaseService().getDatabaseHandle() !== databaseHandle;

  if (needsActivation) {
    const opened = await openLogDirDatabase(logDir);
    if (!opened) {
      throw new Error("Database service not available");
    }
    await fetchEngine.start({
      api: getApi(),
      database: opened,
      sink: createLogsContentSink(opened, logDir),
    });
    engineDir = logDir;
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
 * (`syncLogs`, `fetchLog`). Dir mode also opens the per-dir database;
 * single-file mode starts the engine alone (the database stays unopened, so
 * reads miss and writes are cache-only). An ensure for a new dir tears the
 * old activation down first (engine `start()` self-stops; the database
 * re-points).
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
          api: getApi(),
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
 * subscriber has activated). `opts.fresh` threads through to `engine.fetch`
 * for callers that know the cached row is stale (e.g. after an edit).
 */
export const fetchLog = async (
  logDir: string,
  logFile: string,
  opts?: { fresh?: boolean }
): Promise<LogDetails> => {
  await ensureFetchEngine(logDir);
  return fetchEngine.fetch(logFile, "user", opts);
};

/**
 * Enqueue-or-bump a preview fetch, activating the engine for `logDir` on
 * demand like `fetchLog` — but fire-and-forget (no waiter), since hooks read
 * the result off the sink/cache rather than awaiting a promise here.
 */
export const requestPreview = (
  logDir: string,
  logFile: string,
  priority?: FetchPriority
): void => {
  void ensureFetchEngine(logDir).then(() =>
    fetchEngine.requestPreview(logFile, priority ?? "user")
  );
};

// Serialize listing syncs with a trailing coalesce: a request arriving
// mid-sync waits out the in-flight run, then triggers exactly one more (the
// event prompting it may postdate the in-flight run's server read); requests
// arriving while a trailing run is already queued share the in-flight
// promise. Concurrency policy only — the diff itself is the stateless
// `syncListing`, and scheduling is react-query's (the sync query + tick
// invalidation).
let pendingSync: Promise<LogHandle[]> | null = null;
let syncQueued = false;

const serializedSyncListing = async (): Promise<LogHandle[]> => {
  if (pendingSync && syncQueued) {
    return pendingSync;
  }
  if (pendingSync) {
    syncQueued = true;
    // The in-flight run's failure belongs to its caller; ours still runs.
    await pendingSync.catch(() => {});
    syncQueued = false;
    return serializedSyncListing();
  }
  pendingSync = syncListing(getApi(), fetchEngine);
  try {
    return await pendingSync;
  } finally {
    pendingSync = null;
  }
};

/**
 * Ensure the engine is active for `logDir` (defaulting to the resolved dir),
 * then run a listing sync. The queryFn behind `useLogsSync` — listing
 * freshness is driven by its subscribers. No-op in single-file mode / before
 * a dir is resolved.
 */
export const syncLogs = async (
  logDir: string | undefined = getLogDir()
): Promise<LogHandle[]> => {
  if (!logDir || getAppConfig().singleFileMode) {
    return [];
  }
  await ensureFetchEngine(logDir);
  return serializedSyncListing();
};
