import { LogHandle } from "@tsmono/inspect-common";

import { AppConfig, getAppConfig } from "../app_config";
import { DatabaseService } from "../client/database";

import { getDatabaseService } from "./databaseServiceInstance";
import { fetchEngine } from "./fetchEngine";
import { syncListing } from "./listingSync";
import { createLogsContentSink } from "./logsContent";

// Open the (unified) IndexedDB and mark `logDir`'s sync scope active.
// Returns the (already-constructed) DatabaseService once its database is
// open, or undefined if unavailable.
export const openLogDirDatabase = async (
  logDir: string
): Promise<DatabaseService | undefined> => {
  const databaseService = getDatabaseService();
  try {
    await databaseService.openDatabase();
    await databaseService.touchSyncScope(logDir);
    return databaseService;
  } catch (e) {
    console.log(e);
    return undefined;
  }
};

// Start the engine for a config snapshot — the composition root: the
// database, api, and per-dir cache sink are wired here. Dir mode also opens
// the per-dir database; single-file mode starts the engine alone (the
// database stays unopened, so reads miss and writes are cache-only).
const startEngine = async (config: AppConfig): Promise<void> => {
  const { api, logDir } = config;
  // Bump the engine epoch before re-scoping, so an in-flight listing sync
  // for the old dir is fenced (see `ListingUpdate.epoch`) before its
  // writes could land in the new session.
  fetchEngine.stop();
  if (config.singleFileMode) {
    const database = getDatabaseService();
    await fetchEngine.start({
      api,
      database,
      sink: createLogsContentSink(database, logDir),
      logDir,
    });
    return;
  }
  const opened = await openLogDirDatabase(logDir);
  if (!opened) {
    throw new Error("Database service not available");
  }
  await fetchEngine.start({
    api,
    database: opened,
    sink: createLogsContentSink(opened, logDir),
    logDir,
  });
};

// The current activation: which config snapshot the engine is (becoming)
// active for. Written only by activate/deactivate below — acquisition paths
// never start the engine themselves; they await `engineReady`.
let activation: { config: AppConfig; promise: Promise<void> } | null = null;

// Callers that arrived before the first activation (child effects run before
// the controller's parent effect on initial mount). Settled — matched dirs
// resolved, others rejected — as soon as an activation lands.
let waiters: Array<{
  logDir: string;
  resolve: (ready: Promise<void>) => void;
  reject: (reason: Error) => void;
}> = [];

const staleDirError = (logDir: string) =>
  new Error(`fetch engine is not active for ${logDir}`);

const settleWaiters = () => {
  const settled = waiters;
  waiters = [];
  for (const waiter of settled) {
    if (activation && activation.config.logDir === waiter.logDir) {
      waiter.resolve(activation.promise);
    } else {
      waiter.reject(staleDirError(waiter.logDir));
    }
  }
};

/**
 * (Re)start the engine for a resolved config snapshot. Called only by
 * `<FetchEngineController>` — on mount and again whenever the config changes
 * (a VS Code dir switch replaces the whole config, api and dir together), so
 * the engine's api and dir always come from one snapshot and can't pair
 * across roots.
 */
export const activateFetchEngine = (config: AppConfig): void => {
  const promise = startEngine(config);
  // Observe the rejection so an activation nobody awaits (e.g. failure before
  // any query ran) doesn't surface as an unhandled rejection; awaiting
  // callers still see the original promise reject.
  promise.catch(() => {});
  activation = { config, promise };
  settleWaiters();
};

/** Stop the engine (controller unmount / config teardown before restart). */
export const deactivateFetchEngine = (): void => {
  fetchEngine.stop();
  activation = null;
};

// Await the engine being active for `logDir`. Callers racing ahead of the
// controller's first activation wait; a caller whose dir isn't the active
// one is stale (its config snapshot predates a dir switch) and rejects — its
// query is keyed under the old dir and no longer mounted.
const engineReady = (logDir: string): Promise<void> => {
  if (activation) {
    return activation.config.logDir === logDir
      ? activation.promise
      : Promise.reject(staleDirError(logDir));
  }
  return new Promise<void>((resolve, reject) => {
    waiters.push({
      logDir,
      resolve: (ready) => resolve(ready),
      reject,
    });
  });
};

/**
 * Fetch a log's details at user priority. `opts` threads through to
 * `engine.fetch`: `fresh` for callers that know the cached row is stale
 * (e.g. after an edit), `passive` for ensure-presence callers that don't
 * want to declare active interest (see `useLogHeader`'s `demand` option).
 */
export const fetchLog = async (
  logDir: string,
  logFile: string,
  opts?: { fresh?: boolean; passive?: boolean }
): Promise<void> => {
  await engineReady(logDir);
  return fetchEngine.ensure(logFile, {
    depth: "detailed",
    priority: "user",
    fresh: opts?.fresh,
    demand: opts?.passive ? "passive" : "active",
  });
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
  if (!activation) {
    throw new Error("fetch engine is not active");
  }
  // The api the engine was started with — same snapshot, so the listing the
  // sync reads and the dir its writes are scoped to can't diverge.
  pendingSync = syncListing(activation.config.api, fetchEngine);
  try {
    return await pendingSync;
  } finally {
    pendingSync = null;
  }
};

/**
 * Run a listing sync for `logDir` once the engine is active for it. The
 * queryFn behind `useLogsSync` — listing freshness is driven by its
 * subscribers. No-op in single-file mode.
 */
export const syncLogs = async (logDir: string): Promise<LogHandle[]> => {
  if (getAppConfig().singleFileMode) {
    return [];
  }
  await engineReady(logDir);
  return serializedSyncListing();
};
