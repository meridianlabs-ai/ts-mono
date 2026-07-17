import { useQuery } from "@tanstack/react-query";

import {
  databaseLogsListingKeyRoot,
  readLogsOverview,
  type LogsOverview,
  type LogsOverviewView,
} from "../../log_data";

interface UseLogsOverviewParams {
  logDir: string;
  /** Cache identity of the view (see `useDatabaseLogsListingQuery`'s
   *  `universe`) — everything `view` reads beyond the records. `undefined`
   *  while the scope is hydrating (disables the query). */
  universe: string | undefined;
  view: LogsOverviewView;
}

export interface LogsOverviewResult {
  overview: LogsOverview | undefined;
  /** No overview to show yet (hydrating or first read in flight). */
  pending: boolean;
  error: Error | undefined;
}

/**
 * The page-level aggregates beside the row query (see `readLogsOverview`).
 * Keyed under the listing root so the write path's throttled invalidation
 * refreshes it alongside the row queries.
 */
export const useLogsOverview = ({
  logDir,
  universe,
  view,
}: UseLogsOverviewParams): LogsOverviewResult => {
  const query = useQuery({
    queryKey: [...databaseLogsListingKeyRoot, "overview", logDir, universe],
    queryFn: () => readLogsOverview(logDir, view),
    enabled: universe !== undefined,
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  return {
    overview: query.data,
    pending: query.isPending,
    error: query.error ?? undefined,
  };
};
