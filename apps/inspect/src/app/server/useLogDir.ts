import { useAsyncDataFromQuery } from "@tsmono/react/hooks";
import { AsyncData } from "@tsmono/util";

import { LogRoot } from "../../client/api/types";
import { queryClient } from "../../state/queryClient";
import { storeImplementation, useApi, useStore } from "../../state/store";
import { isSingleFileMode } from "../singleFileMode";

export const logDirKey = ["log-dir"] as const;

/**
 * Loads the server log root (`log_dir` + `abs_log_dir`) asynchronously. Gated in
 * `AppLayout`'s dir-mode branch — see
 * `design/migration/loglist-content-zustand-extraction.md`. Disabled in
 * single-file mode, where the log dir is route-derived (not `get_log_root`).
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
 * The current log directory. In dir mode it comes from the gated log-root query
 * (resolved below `AppLayout`'s gate); in single-file mode it's the route-derived
 * value the legacy flow stores in zustand. Both hooks are called unconditionally
 * — the branch is a stable module constant.
 */
export const useLogDir = (): string | undefined => {
  const singleFileLogDir = useStore((s) =>
    isSingleFileMode ? s.logs.logDir : undefined
  );
  const root = useLogRootAsync();
  return isSingleFileMode ? singleFileLogDir : root.data?.log_dir;
};

/** The absolute log directory (dir mode only; single-file leaves it unset). */
export const useAbsLogDir = (): string | undefined => {
  const singleFileAbs = useStore((s) =>
    isSingleFileMode ? s.logs.absLogDir : undefined
  );
  const root = useLogRootAsync();
  return isSingleFileMode ? singleFileAbs : root.data?.abs_log_dir;
};

/** Non-React accessor for slice / routing code. */
export const getLogDir = (): string | undefined =>
  isSingleFileMode
    ? storeImplementation?.getState().logs.logDir
    : cachedLogRoot()?.log_dir;

export const getAbsLogDir = (): string | undefined =>
  isSingleFileMode
    ? storeImplementation?.getState().logs.absLogDir
    : cachedLogRoot()?.abs_log_dir;
