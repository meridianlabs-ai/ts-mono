import { QueryFunction } from "@tanstack/react-query";

import { useAsyncDataFromQuery, useMapAsyncData } from "@tsmono/react/hooks";
import { AsyncData } from "@tsmono/util";

import { ClientAPI, LogRoot } from "../../client/api/types";
import { queryClient } from "../../state/queryClient";
import { useApi } from "../../state/store";
import {
  isSingleFileMode,
  readEmbeddedStartupState,
  resolveEmbeddedLogDir,
  resolveSingleFileLogDir,
} from "../singleFileMode";
import { parseUrlLogSource } from "../urlLogSource";

export const logDirKey = ["log-dir"] as const;

const rootFromDir = (logDir: string, absLogDir?: string): LogRoot => ({
  logs: [],
  log_dir: logDir,
  abs_log_dir: absLogDir,
});

/**
 * The embedded (VS Code) log root, resolved synchronously from the
 * `#logview-state` the host injects. Returns undefined when there's no embedded
 * state — a `?log_file=` deep link or directory mode — so callers fall back to
 * their own source.
 */
const embeddedLogRoot = (): LogRoot | undefined => {
  const embedded = readEmbeddedStartupState();
  return embedded
    ? rootFromDir(resolveEmbeddedLogDir(decodeURIComponent(embedded.url)))
    : undefined;
};

/**
 * The single-file log root, split pull vs. synchronous seed:
 * - `?log_file=` URL: derive the dir from the file (pull, possibly an api call).
 * - embedded (VS Code): resolve the dir from `#logview-state` synchronously.
 */
const singleFileLogRoot = (
  api: ClientAPI
): QueryFunction<LogRoot, typeof logDirKey> => {
  const source = parseUrlLogSource(window.location.search);
  if (source.kind === "file") {
    return async () =>
      rootFromDir(await resolveSingleFileLogDir(source.logFile, api));
  }
  return () => {
    const root = embeddedLogRoot();
    if (!root) {
      throw new Error(
        "single-file mode without ?log_file= implies embedded #logview-state"
      );
    }
    return root;
  };
};

/**
 * Loads the log root (`log_dir` + `abs_log_dir`) into the gated `["log-dir"]`
 * cache. All sources land in the same cache, so the accessors below are
 * mode-agnostic.
 */
export const useLogRootAsync = (): AsyncData<LogRoot> => {
  const api = useApi();
  // Embedded (VS Code) startup state is in the DOM before first render, so seed
  // it as initialData — the gate resolves immediately, no loading flash.
  return useAsyncDataFromQuery({
    queryKey: logDirKey,
    staleTime: Infinity,
    ...(isSingleFileMode
      ? { queryFn: singleFileLogRoot(api), initialData: embeddedLogRoot() }
      : { queryFn: () => api.get_log_root() }),
  });
};

const cachedLogRoot = (): LogRoot | undefined =>
  queryClient.getQueryData<LogRoot>(logDirKey);

/**
 * Write the resolved log root into the gated `["log-dir"]` cache. Used by
 * embedded (VS Code) live navigation — the host posting a different log
 * mid-session via <App>'s onMessage — and by tests seeding the dir without
 * mounting a query. Production startup dirs reach the cache through the queryFn
 * / initialData (`useLogRootAsync`), not here.
 */
export const setLogRoot = (logDir: string, absLogDir?: string): void => {
  queryClient.setQueryData<LogRoot>(logDirKey, rootFromDir(logDir, absLogDir));
};

/** The current log directory (from the `["log-dir"]` cache, both modes). */
export const useLogDirAsync = (): AsyncData<string | undefined> =>
  useMapAsyncData(useLogRootAsync(), logDirFromLogRoot);
const logDirFromLogRoot = (x: LogRoot) => x.log_dir;

export const useLogDir = (): string => {
  const result = useLogDirAsync().data;
  if (!result) throw new Error("Log dir not loaded");
  return result;
};

/** The absolute log directory (dir mode only; single-file leaves it unset). */
export const useAbsLogDir = (): string | undefined =>
  useLogRootAsync().data?.abs_log_dir;

/** Non-React accessor for slice / routing code. */
export const getLogDir = (): string | undefined => cachedLogRoot()?.log_dir;

export const getAbsLogDir = (): string | undefined =>
  cachedLogRoot()?.abs_log_dir;
