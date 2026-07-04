import { skipToken } from "@tanstack/react-query";

import { useAsyncDataFromQuery } from "@tsmono/react/hooks";
import { AsyncData } from "@tsmono/util";

import { LogDetails } from "../client/api/types";
import { queryClient } from "../state/queryClient";

import { fetchLog } from "./replicationControl";

export const logDetailQueryKey = (
  logDir: string,
  logFile: string | undefined
) => ["log_data", "detail", logDir, logFile ?? null] as const;

/**
 * One log's details as a react-query query over the fetch engine. The queryFn
 * is a user-priority engine fetch (read-through, so a cached log settles
 * instantly and refreshes in the background). Refreshing a log is
 * invalidating this query (`invalidateLogDetail`) — there is no imperative
 * refresh path.
 *
 * Consumers generally read the details *collection* (`useLogDetail`), which
 * the engine's sink keeps fresher than this query's own snapshot (polling and
 * replication write there); this query is the fetch trigger and the
 * loading/error surface.
 */
// TODO: needs revisiting on the path to a single coherent data story. This
// query's cached result duplicates the log's row in the ["log_data", "details", logDir]
// collection (the sink writes every fetch there too). The duplicate survives
// because LogLoadController keys off its identity as a "fetch settled" event —
// distinct from the collection's every-poll-tick "data changed" stream.
export const useLogDetailQuery = (
  logDir: string,
  logFile: string | undefined
): AsyncData<LogDetails> =>
  useAsyncDataFromQuery({
    queryKey: logDetailQueryKey(logDir, logFile),
    queryFn: logFile ? () => fetchLog(logDir, logFile) : skipToken,
    // The engine owns freshness (read-through + background refresh), so a
    // remount may always re-run the queryFn; a failed fetch surfaces
    // immediately rather than react-query retrying.
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

/** Re-fetch a log's details — the log-detail *invalidate* verb (toolbar
 *  refresh / edit-save). Fire-and-forget: completion is observed through the
 *  query's loading state, never awaited. */
export const invalidateLogDetail = (
  logDir: string,
  logFile: string | undefined
): void => {
  void queryClient.invalidateQueries({
    queryKey: logDetailQueryKey(logDir, logFile),
  });
};
