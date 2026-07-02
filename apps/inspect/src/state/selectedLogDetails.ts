import { skipToken } from "@tanstack/react-query";

import { useAsyncDataFromQuery } from "@tsmono/react/hooks";
import { AsyncData } from "@tsmono/util";

import { useLogDir } from "../app_config";
import { LogDetails } from "../client/api/types";
import { fetchLog } from "../log_data";

import { queryClient } from "./queryClient";
import { useStore } from "./store";

export const selectedLogQueryKey = (
  logDir: string,
  logFile: string | undefined
) => ["selected-log", logDir, logFile ?? null] as const;

/**
 * The selected log's details as a react-query query over the fetch engine.
 * Selection's *effect* is reactive: the query is keyed on the selection and
 * its queryFn is a user-priority engine fetch (read-through, so a cached log
 * settles instantly and refreshes in the background). Refreshing the open log
 * is invalidating this query — there is no imperative refresh path.
 *
 * Consumers generally read the details *collection* (`useLogDetail`), which
 * the engine's sink keeps fresher than this query's own snapshot (polling and
 * replication write there); this query is the fetch trigger and the
 * loading/error surface.
 */
// TODO: needs revisiting on the path to a single coherent data story. This
// query's cached result duplicates the log's row in the ["log-details", logDir]
// collection (the sink writes every fetch there too). The duplicate survives
// because LogLoadController keys off its identity as a "fetch settled" event —
// distinct from the collection's every-poll-tick "data changed" stream.
export const useSelectedLogQuery = (): AsyncData<LogDetails> => {
  const logDir = useLogDir();
  const selectedLogFile = useStore((state) => state.logs.selectedLogFile);
  return useAsyncDataFromQuery({
    queryKey: selectedLogQueryKey(logDir, selectedLogFile),
    queryFn: selectedLogFile
      ? () => fetchLog(logDir, selectedLogFile)
      : skipToken,
    // The engine owns freshness (read-through + background refresh), so a
    // remount may always re-run the queryFn; a failed fetch surfaces
    // immediately rather than react-query retrying.
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
};

/** Whether the selected log's details are loading (false when nothing is
 *  selected — the query idles on `skipToken` then, which reads as pending). */
export const useSelectedLogLoading = (): boolean => {
  const selectedLogFile = useStore((state) => state.logs.selectedLogFile);
  return useSelectedLogQuery().loading && selectedLogFile !== undefined;
};

/** Re-fetch the selected log's details (toolbar refresh / edit-save). */
export const invalidateSelectedLog = (
  logDir: string,
  logFile: string | undefined
): Promise<void> =>
  queryClient.invalidateQueries({
    queryKey: selectedLogQueryKey(logDir, logFile),
  });
