import { LogHandle } from "@tsmono/inspect-common/types";
import { useAsyncDataFromQuery } from "@tsmono/react/hooks";
import { AsyncData } from "@tsmono/util";

import { useLogDir } from "../app/server/useLogDir";

import { syncLogs } from "./replicationControl";

/**
 * Sync the log listing for a mounted panel, as a react-query query: the
 * panel's loading / error states derive from its AsyncData (nothing sets a
 * loading flag imperatively). The listing data itself flows through the
 * logsContent collections via the engine's sink — this query only triggers
 * discovery and carries its status. Keyed by the panel's path scope so
 * navigating between folders re-syncs. No-ops (settling to []) in single-file
 * mode.
 */
export const useLogsSync = (scope: string): AsyncData<LogHandle[]> => {
  const logDir = useLogDir();
  return useAsyncDataFromQuery({
    queryKey: ["logs-sync", logDir, scope],
    queryFn: () => syncLogs(logDir),
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
};
