import { useCallback } from "react";

import { useAsyncDataFromQuery, useMapAsyncData } from "@tsmono/react/hooks";
import { AsyncData } from "@tsmono/util";

import { LogRoot } from "../../client/api/types";
import { queryClient } from "../../state/queryClient";
import { useApi } from "../../state/store";
import { isSingleFileMode } from "../singleFileMode";

export const logDirKey = ["log-dir"] as const;

/**
 * Loads the server log root (`log_dir` + `abs_log_dir`). In dir mode the gated
 * `["log-dir"]` query fetches it via `get_log_root`; in single-file mode the
 * query is disabled and the value is seeded by `setLogDir` (the single-file
 * loader derives the dir from the selected file). Either way it lands in the
 * same cache, so the accessors below are mode-agnostic.
 */
export const useLogRootAsync = (): AsyncData<LogRoot> => {
  const api = useApi();
  return useAsyncDataFromQuery({
    queryKey: logDirKey,
    queryFn: () => api.get_log_root(),
    staleTime: Infinity,
    enabled: !isSingleFileMode,
  });
};

const cachedLogRoot = (): LogRoot | undefined =>
  queryClient.getQueryData<LogRoot>(logDirKey);

/**
 * Seeds the log dir into the `["log-dir"]` cache. Used in single-file mode,
 * where the dir is derived from the selected file rather than fetched from the
 * server; dir mode populates the same cache through the query's `queryFn`.
 */
export const setLogDir = (logDir: string, absLogDir?: string): void => {
  queryClient.setQueryData<LogRoot>(logDirKey, {
    logs: [],
    log_dir: logDir,
    abs_log_dir: absLogDir,
  });
};

/** The current log directory (from the `["log-dir"]` cache, both modes). */
export const useLogDirAsync = (): AsyncData<string | undefined> =>
  useMapAsyncData(
    useLogRootAsync(),
    useCallback((x) => x.log_dir, [])
  );

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
