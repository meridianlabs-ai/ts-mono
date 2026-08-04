import { ClientAPI, LogRoot } from "../client/api/types";
import { selectLogFile } from "../state/actions";
import { queryClient } from "../state/queryClient";

import { APP_CONFIG_KEY } from "./hooks";
import { BackendBootstrap, resolveBackend } from "./resolveBackend";
import {
  detectInitialSingleFileMode,
  readEmbeddedStartupState,
  resolveEmbeddedLogDir,
  resolveSingleFileLogDir,
} from "./singleFileMode";
import { parseUrlLogSource } from "./urlLogSource";

/**
 * The application configuration — the one currency. Everything the viewer needs
 * to know about how it was launched and what it's pointed at. Obtained, in
 * priority order:
 *   1. `useAppConfig()`      — below the gate; reactive. Prefer this.
 *   2. `useAppConfigAsync()` — how the gate itself waits on the config.
 *   3. `resolveAppConfig()`  — async, memoized; for non-react code that needs it.
 *   4. `getAppConfig()`      — sync, asserts resolved; the non-react escape hatch.
 *
 * `api` and `logDir` are one snapshot: the api instance is bound to `logDir`
 * at construction and never answers about any other dir (see the contract on
 * `ClientAPI`). A dir change replaces the whole config — new api, new dir,
 * published together (`setLogRoot`) — so a query's key and its fetch can
 * never pair values from different roots.
 */
export interface AppConfig {
  api: ClientAPI;
  singleFileMode: boolean;
  loader: "direct" | "replicator";
  logFile?: string;
  inspect_version: string;
  scout_version: string | null;
  logDir: string;
  absLogDir?: string;
}

/**
 * The synchronously-knowable prefix of the config — resolved from the URL + DOM
 * before any network call. Infrastructure only: it's what the async resolution
 * builds on, and the one thing the pre-gate boot path (`main.tsx` / the store)
 * can read before the full config exists. No `ClientAPI` lives here — an api
 * instance requires a resolved dir, so the bootstrap carries the backend's
 * dir-discovery + construction recipe instead (see `BackendBootstrap`).
 */
export interface AppConfigBootstrap {
  backend: BackendBootstrap;
  singleFileMode: boolean;
  loader: "direct" | "replicator";
  logFile?: string;
}

/**
 * Resolve the bootstrap from the invocation-time log source. The single place the
 * URL log source is parsed (see `app_config/urlLogSource.ts`).
 */
export const resolveBootstrap = (): AppConfigBootstrap => {
  const source = parseUrlLogSource(window.location.search);
  const singleFileMode = detectInitialSingleFileMode(source, document);
  return {
    backend: resolveBackend(source),
    singleFileMode,
    loader: singleFileMode ? "direct" : "replicator",
    logFile: source.kind === "file" ? source.logFile : undefined,
  };
};

let bootstrap: AppConfigBootstrap | undefined;

/** The memoized bootstrap. Infra only (boot path); resolved once per session. */
export const getBootstrap = (): AppConfigBootstrap =>
  (bootstrap ??= resolveBootstrap());

const rootFromDir = (logDir: string, absLogDir?: string): LogRoot => ({
  logs: [],
  log_dir: logDir,
  abs_log_dir: absLogDir,
});

/**
 * The embedded (VS Code) log root, resolved synchronously from the
 * `#logview-state` the host injects. Undefined when there's no embedded state (a
 * `?log_file=` deep link or directory mode).
 */
const embeddedLogRoot = (): LogRoot | undefined => {
  const embedded = readEmbeddedStartupState();
  return embedded
    ? rootFromDir(resolveEmbeddedLogDir(decodeURIComponent(embedded.url)))
    : undefined;
};

/**
 * Resolve the log root for this session — the determination logic:
 * - directory mode → the backend enumerates the root (its bootstrap probe)
 * - single-file `?log_file=` → derive the dir from the file
 * - embedded (VS Code) → the dir seeded in the DOM
 */
const resolveLogRoot = async (bs: AppConfigBootstrap): Promise<LogRoot> => {
  if (!bs.singleFileMode) {
    const root = await bs.backend.resolveLogRoot();
    if (!root) {
      throw new Error("Unable to determine log paths.");
    }
    return root;
  }
  if (bs.logFile !== undefined) {
    return rootFromDir(
      await resolveSingleFileLogDir(bs.logFile, bs.backend.resolveConfiguredDir)
    );
  }
  const embedded = embeddedLogRoot();
  if (!embedded) {
    throw new Error(
      "single-file mode without ?log_file= implies embedded #logview-state"
    );
  }
  return embedded;
};

/**
 * Resolve the full config from its bootstrap. Dir discovery runs first — an
 * api instance is bound to one dir at construction, so no `ClientAPI` can
 * exist until the dir is known — then the backend's factory builds the
 * instance and the version round-trip runs through it. Framework-free (no
 * react-query) and throws on failure so the query surfaces the error.
 */
export const loadResolvedAppConfig = async (
  bs: AppConfigBootstrap
): Promise<AppConfig> => {
  const logRoot = await resolveLogRoot(bs);
  // Prefer the canonical URI form — the namespace file names live in — so
  // prefix scoping (IndexedDB reads, samples scopes) holds. log_dir alone is
  // a display form on local view servers (aliased/relative path).
  const logDir = logRoot.log_dir_uri ?? logRoot.log_dir;
  if (!logDir) {
    throw new Error("Log dir not resolved");
  }
  const api = bs.backend.createApi(logDir);
  const versions = await api.get_app_config();
  return {
    api,
    singleFileMode: bs.singleFileMode,
    loader: bs.loader,
    logFile: bs.logFile,
    inspect_version: versions.inspect_version,
    scout_version: versions.scout_version ?? null,
    logDir,
    absLogDir: logRoot.abs_log_dir,
  };
};

let appConfig: AppConfig | undefined;

/**
 * Resolve the full config, memoized to the module singleton. This is the query
 * function `useAppConfigAsync` runs; a non-react caller can await it directly,
 * but you're better off with the hooks.
 */
export const resolveAppConfig = async (): Promise<AppConfig> => {
  if (!appConfig) {
    appConfig = await loadResolvedAppConfig(getBootstrap());
    // The `?log_file=` deep-link selection is a once-per-session startup fact,
    // so it lives here rather than in a mounted component. After the singleton
    // assignment: selectLogFile absolutizes against the resolved logDir.
    if (appConfig.logFile !== undefined) {
      selectLogFile(appConfig.logFile);
    }
  }
  return appConfig;
};

/**
 * The resolved config, read synchronously. Asserts it's been resolved (the app
 * renders below the gate that awaits it). The non-react escape hatch — a react
 * component should use `useAppConfig` instead.
 */
export const getAppConfig = (): AppConfig => {
  if (!appConfig) throw new Error("App config not resolved");
  return appConfig;
};

/** The resolved config if present, without asserting (for optional reads). */
export const peekAppConfig = (): AppConfig | undefined => appConfig;

/** Seed the resolved singleton directly. For tests. */
export const initAppConfig = (config: AppConfig): AppConfig =>
  (appConfig = config);

/**
 * Point the session at a different log dir — embedded (VS Code) live
 * navigation, the one impure operation after resolution. Rebuilds, never
 * mutates: the backend factory constructs a fresh api bound to the new dir,
 * and the new config (api + logDir together) replaces the singleton and the
 * react-query mirror as one snapshot. In-flight responses from the old
 * instance are still about the old dir and land under the old dir's keys.
 *
 * A same-dir call is a no-op: preserving config identity keeps the fetch
 * engine running and the api's caches warm (the host re-sends `updateState`
 * for the dir the gate already resolved on VS Code single-file boot).
 */
export const setLogRoot = (logDir: string, absLogDir?: string): void => {
  const current = getAppConfig();
  if (current.logDir === logDir && current.absLogDir === absLogDir) {
    return;
  }
  appConfig = {
    ...current,
    api: getBootstrap().backend.createApi(logDir),
    logDir,
    absLogDir,
  };
  queryClient.setQueryData(APP_CONFIG_KEY, appConfig);
};
