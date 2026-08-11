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
const startEngine = async (config: AppConfig, seq: number): Promise<void> => {
  const { api, logDir } = config;
  // Bump the engine epoch before re-scoping, so an in-flight listing sync
  // for the old dir is fenced (see `ListingUpdate.epoch`) before its
  // writes could land in the new session.
  fetchEngine.stop();
  // The bumped epoch doubles as this start's supersede fence: a dir switch
  // or final unmount landing while the IndexedDB open below is suspended
  // bumps it again (their `stop()`), and a superseded start must never touch
  // the engine — whichever continuation landed last would win, leaving the
  // engine wired for one dir while `activation.config` claims another.
  //
  // Deliberately NOT a per-activation AbortSignal (#492): the epoch exists
  // regardless (the engine fences its own claimed batches, restarts, and
  // listing syncs with it, for any caller — including same-dir restarts a
  // dir-keyed token would miss), a signal's `throwIfAborted()` would be
  // exactly as hand-placed as this re-check, and the dir matching below is
  // the caller contract, not a fence — acquisition paths hold only a dir
  // (waiters queue before any activation exists to hand them a token), and
  // dir equality deliberately lets them span a same-dir re-activation
  // (StrictMode remount, failed-start retry) where token identity would
  // spuriously reject. A per-activation token would subsume neither
  // mechanism — it would be a third.
  const epoch = fetchEngine.epoch();
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
  if (fetchEngine.epoch() !== epoch) {
    // Superseded — but a supersede for the SAME dir (StrictMode remount,
    // failed-start retry) is what the dir-equality contract above is meant to
    // span, so it must not reject: callers already hold this promise, and
    // react-query doesn't re-invoke `queryFn` on remount, so rejecting here
    // strands the listing until the next poll (~50s). Adopt the live
    // activation instead, so those callers settle with the running engine.
    const current = activation;
    if (current && current.seq > seq && current.config.logDir === logDir) {
      return current.promise;
    }
    throw staleDirError(logDir);
  }
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
// active for. `failed` marks a rejected start so the next acquisition retries
// instead of re-awaiting the same rejection. Written only by
// activate/deactivate (and the retry in `engineReady`) — acquisition paths
// never start the engine themselves; they await `engineReady`.
type Activation = {
  // Monotonic id. A superseded start adopts only a *strictly newer*
  // activation, which also rules out adopting itself — resolving a promise
  // with itself is a chaining cycle.
  seq: number;
  config: AppConfig;
  promise: Promise<void>;
  failed: boolean;
};

let activationSeq = 0;
let activation: Activation | null = null;

// Set on controller unmount so a caller landing after a final deactivation
// rejects instead of queueing a waiter that could never settle. Cleared on
// the next activation (a config-change remount).
let deactivated = false;

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

const beginActivation = (config: AppConfig): Activation => {
  const seq = ++activationSeq;
  const entry: Activation = {
    seq,
    config,
    promise: startEngine(config, seq),
    failed: false,
  };
  // Mark the failure for retry, and observe the rejection so an activation
  // nobody awaits (e.g. failure before any query ran) doesn't surface as an
  // unhandled rejection; awaiting callers still see the original promise
  // reject.
  entry.promise.catch(() => {
    entry.failed = true;
  });
  return entry;
};

/**
 * (Re)start the engine for a resolved config snapshot. Called only by
 * `<FetchEngineController>` — on mount and again whenever the config changes
 * (a VS Code dir switch replaces the whole config, api and dir together), so
 * the engine's api and dir always come from one snapshot and can't pair
 * across roots.
 */
export const activateFetchEngine = (config: AppConfig): void => {
  deactivated = false;
  activation = beginActivation(config);
  settleWaiters();
};

/** Stop the engine (controller unmount / config teardown before restart).
 *  The `stop()` epoch bump also supersedes any still-settling start, so one
 *  resuming after a final unmount bails instead of re-wiring the stopped
 *  engine. */
export const deactivateFetchEngine = (): void => {
  fetchEngine.stop();
  activation = null;
  deactivated = true;
  // With no activation, every queued waiter rejects as stale.
  settleWaiters();
};

// Await the engine being active for `logDir`. Callers racing ahead of the
// controller's first activation wait; a caller whose dir isn't the active
// one is stale (its config snapshot predates a dir switch) and rejects — its
// query is keyed under the old dir and no longer mounted.
const engineReady = (logDir: string): Promise<void> => {
  if (activation) {
    if (activation.config.logDir !== logDir) {
      return Promise.reject(staleDirError(logDir));
    }
    // A failed start isn't sticky: re-attempt on the next acquisition (the
    // listing query polls, so a transient failure — e.g. an IndexedDB open
    // hiccup — heals on a later tick instead of pinning the session broken).
    if (activation.failed) {
      activation = beginActivation(activation.config);
    }
    return activation.promise;
  }
  if (deactivated) {
    return Promise.reject(staleDirError(logDir));
  }
  return new Promise<void>((resolve, reject) => {
    waiters.push({ logDir, resolve, reject });
  });
};

// A dir switch can land while an awaited activation settles (`startEngine`
// spans the database open), leaving the engine owned by the new dir when the
// caller resumes. Callers re-validate before touching the engine.
const requireActiveDir = (logDir: string): { config: AppConfig } => {
  const current = activation;
  if (!current || current.config.logDir !== logDir) {
    throw staleDirError(logDir);
  }
  return current;
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
  requireActiveDir(logDir);
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
let pendingSync: { logDir: string; promise: Promise<LogHandle[]> } | null =
  null;
let syncQueued = false;

const serializedSyncListing = async (logDir: string): Promise<LogHandle[]> => {
  // Share the in-flight run only when it's for the caller's dir — across a
  // dir switch it would answer about the wrong root.
  if (pendingSync && syncQueued && pendingSync.logDir === logDir) {
    return pendingSync.promise;
  }
  if (pendingSync) {
    syncQueued = true;
    // The in-flight run's failure belongs to its caller; ours still runs.
    await pendingSync.promise.catch(() => {});
    syncQueued = false;
    return serializedSyncListing(logDir);
  }
  const current = requireActiveDir(logDir);
  // The api the engine was started with — same snapshot, so the listing the
  // sync reads and the dir its writes are scoped to can't diverge.
  const promise = syncListing(current.config.api, fetchEngine);
  pendingSync = { logDir, promise };
  try {
    return await promise;
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
  return serializedSyncListing(logDir);
};
