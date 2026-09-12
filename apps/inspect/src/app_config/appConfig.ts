import { isUri, join } from "@tsmono/util";

import {
  configureLogLocationPolicy,
  evaluateLogLocation,
  LogLocationScope,
  resetLogLocationPolicy,
} from "../client/api/logLocation";
import { ClientAPI, LogRoot } from "../client/api/types";
import { selectLogFile } from "../state/actions";
import { queryClient } from "../state/queryClient";

import { APP_CONFIG_KEY } from "./hooks";
import { BackendBootstrap, resolveBackend } from "./resolveBackend";
import {
  readEmbeddedStartupState,
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
  browserDirect?: boolean;
  locationScope?: LogLocationScope;
  startupProposal?: LogLocationScope;
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
  startupProposal?: { kind: "file" | "directory"; location: string };
  trustedFile?: string;
}

/**
 * Resolve the bootstrap from the invocation-time log source. The single place the
 * URL log source is parsed (see `app_config/urlLogSource.ts`).
 */
export const resolveBootstrap = (): AppConfigBootstrap => {
  const source = parseUrlLogSource(window.location.search);
  const backend = resolveBackend(source);
  const embedded =
    backend.locationSource === "vscode" ? readEmbeddedStartupState() : null;
  const trustedFile =
    backend.configuredLogFile ??
    (embedded?.url ? decodeURIComponent(embedded.url) : undefined);
  const urlFile =
    backend.locationSource === "url" && source.kind === "file"
      ? source.logFile
      : undefined;
  const logFile = trustedFile ?? urlFile;
  const singleFileMode = logFile !== undefined;
  const startupProposal =
    backend.locationSource === "url" && source.kind !== "none"
      ? {
          kind:
            source.kind === "file" ? ("file" as const) : ("directory" as const),
          location: source.kind === "file" ? source.logFile : source.logDir,
        }
      : undefined;
  return {
    backend,
    singleFileMode,
    loader: singleFileMode ? "direct" : "replicator",
    logFile,
    startupProposal,
    trustedFile,
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

/** Resolve a relative file against the log dir unless the page-relative path
 * already falls inside that directory. Publisher config commonly carries
 * both `log_file=hosted/run.eval` and `log_dir=hosted`; joining those values
 * blindly would duplicate the directory, while route paths such as
 * `nested/run.eval` still need to resolve below the configured root. */
export const resolveLogFileLocation = (
  logFile: string,
  logDir: string
): string => {
  if (isUri(logFile)) return logFile;

  try {
    const pageRelative = new URL(logFile, document.baseURI);
    const directory = new URL(
      logDir.endsWith("/") ? logDir : `${logDir}/`,
      document.baseURI
    );
    if (
      pageRelative.origin === directory.origin &&
      pageRelative.pathname.startsWith(directory.pathname)
    ) {
      return logFile;
    }
  } catch {
    // Non-URL proxy paths are resolved by the transport's path join below.
  }

  return join(logFile, logDir);
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
  if (bs.logFile === undefined) {
    const embedded = readEmbeddedStartupState();
    if (!embedded?.url) {
      throw new Error(
        "single-file mode requires a configured or proposed log file"
      );
    }
    return rootFromDir(
      await resolveSingleFileLogDir(decodeURIComponent(embedded.url))
    );
  }
  return rootFromDir(
    await resolveSingleFileLogDir(bs.logFile, bs.backend.resolveConfiguredDir)
  );
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
  const resolvedLogFile =
    bs.logFile === undefined
      ? undefined
      : resolveLogFileLocation(bs.logFile, logDir);
  const scopedLocation = (location: string): string =>
    bs.backend.browserDirect
      ? isUri(location)
        ? location
        : new URL(location, document.baseURI).href
      : location;
  const startupProposal = bs.startupProposal
    ? (() => {
        const location =
          bs.startupProposal.kind === "file"
            ? (resolvedLogFile ?? bs.startupProposal.location)
            : logDir;
        return {
          kind: bs.startupProposal.kind,
          location: scopedLocation(location),
        };
      })()
    : undefined;
  const locationScope: LogLocationScope =
    startupProposal ??
    (bs.trustedFile && resolvedLogFile
      ? { kind: "file", location: scopedLocation(resolvedLogFile) }
      : { kind: "directory", location: scopedLocation(logDir) });
  resetLogLocationPolicy();
  if (bs.backend.browserDirect) {
    const trusted = startupProposal === undefined;
    if (
      trusted &&
      evaluateLogLocation(locationScope.location, locationScope).status ===
        "blocked"
    ) {
      throw new Error("The configured browser log location is not supported.");
    }
    configureLogLocationPolicy(locationScope, trusted);
  }
  return {
    api,
    singleFileMode: bs.singleFileMode,
    loader: bs.loader,
    logFile: bs.logFile,
    inspect_version: versions.inspect_version,
    scout_version: versions.scout_version ?? null,
    logDir,
    absLogDir: logRoot.abs_log_dir,
    browserDirect: bs.backend.browserDirect,
    locationScope,
    startupProposal,
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
export const setLogRoot = (
  logDir: string,
  locationScope: LogLocationScope = { kind: "directory", location: logDir }
): void => {
  const current = getAppConfig();
  const currentScope = current.locationScope ?? {
    kind: "directory",
    location: current.logDir,
  };
  if (
    current.logDir === logDir &&
    currentScope.kind === locationScope.kind &&
    currentScope.location === locationScope.location
  ) {
    return;
  }
  appConfig = {
    ...current,
    api: getBootstrap().backend.createApi(logDir),
    logDir,
    // The boot-time abs form described the old dir; there is none for this one.
    absLogDir: undefined,
    locationScope,
  };
  if (current.browserDirect) {
    configureLogLocationPolicy(locationScope, true);
  }
  queryClient.setQueryData(APP_CONFIG_KEY, appConfig);
};
