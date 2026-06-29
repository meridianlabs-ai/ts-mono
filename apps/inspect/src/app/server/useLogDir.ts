import { QueryFunction } from "@tanstack/react-query";

import { makePushedQuerySource } from "@tsmono/react";
import { useAsyncDataFromQuery, useMapAsyncData } from "@tsmono/react/hooks";
import { AsyncData } from "@tsmono/util";

import { ClientAPI, LogRoot } from "../../client/api/types";
import { queryClient } from "../../state/queryClient";
import { useApi } from "../../state/store";
import { isSingleFileMode, resolveSingleFileLogDir } from "../singleFileMode";
import { parseUrlLogSource } from "../urlLogSource";

export const logDirKey = ["log-dir"] as const;

const rootFromDir = (logDir: string, absLogDir?: string): LogRoot => ({
  logs: [],
  log_dir: logDir,
  abs_log_dir: absLogDir,
});

/**
 * The embedded (VS Code) log root. Its dir has no pull source — it's whatever
 * log the host has opened (initial replay or live navigation), pushed via
 * <App>'s onMessage → `pushLogDirForEmbeddedMode`.
 */
const pushedLogRoot = makePushedQuerySource<LogRoot>(queryClient, logDirKey);

/**
 * The single-file log root, split pull vs. push:
 * - `?log_file=` URL: derive the dir from the file (pull).
 * - embedded (VS Code): await the pushed root (`pushedLogRoot`).
 */
const singleFileLogRoot = (
  api: ClientAPI
): QueryFunction<LogRoot, typeof logDirKey> => {
  const source = parseUrlLogSource(window.location.search);
  return source.kind === "file"
    ? async () =>
        rootFromDir(await resolveSingleFileLogDir(source.logFile, api))
    : pushedLogRoot.queryFn;
};

/**
 * Loads the log root (`log_dir` + `abs_log_dir`) into the gated `["log-dir"]`
 * cache. All sources land in the same cache, so the accessors below are
 * mode-agnostic.
 */
export const useLogRootAsync = (): AsyncData<LogRoot> => {
  const api = useApi();
  return useAsyncDataFromQuery({
    queryKey: logDirKey,
    queryFn: isSingleFileMode
      ? singleFileLogRoot(api)
      : () => api.get_log_root(),
    staleTime: Infinity,
  });
};

const cachedLogRoot = (): LogRoot | undefined =>
  queryClient.getQueryData<LogRoot>(logDirKey);

/**
 * The push entry for embedded (VS Code) mode, where the dir arrives via <App>'s
 * onMessage and can change mid-session — the host telling the viewer which log
 * to display (initial replay or live navigation). Routes through the single
 * encapsulated cache writer (`pushedLogRoot.set`).
 */
export const pushLogDirForEmbeddedMode = (logDir: string): void => {
  pushedLogRoot.set(rootFromDir(logDir));
};

/**
 * Test-only: seed the resolved dir into the `["log-dir"]` cache for tests that
 * read it via the non-React `getLogDir()` without mounting a query. Production
 * dirs reach the cache through the queryFn (`useLogRootAsync`) — dir/URL pull,
 * or the embedded push (`pushLogDirForEmbeddedMode`).
 */
export const seedLogDirForTest = (logDir: string, absLogDir?: string): void => {
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
