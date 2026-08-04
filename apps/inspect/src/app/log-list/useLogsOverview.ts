import { useAsyncDataFromQuery } from "@tsmono/react/hooks";
import { AsyncData } from "@tsmono/util";

import {
  databaseLogsListingKeyRoot,
  type LogsListingData,
  type LogsOverview,
  type LogsOverviewOptions,
} from "../../log_data";

interface UseLogsOverviewParams<TRow> {
  logDir: string;
  /** The view's data scope (see `LogsListingDescriptor.scopeKey`).
   *  `undefined` while the scope is hydrating (disables the query). */
  scopeKey: string | undefined;
  /** The panel's listing data access (shared with the row/match queries). */
  data: LogsListingData<TRow>;
  options: LogsOverviewOptions;
}

/**
 * The page-level aggregates beside the row query (see the listing data's
 * `getOverview`). Keyed under the listing root so the write path's
 * throttled invalidation refreshes it alongside the row queries.
 */
export const useLogsOverview = <TRow>({
  logDir,
  scopeKey,
  data,
  options,
}: UseLogsOverviewParams<TRow>): AsyncData<LogsOverview> => {
  return useAsyncDataFromQuery({
    queryKey: [
      ...databaseLogsListingKeyRoot,
      "overview",
      logDir,
      scopeKey,
      options.showRetriedLogs,
    ],
    queryFn: () => data.getOverview(options),
    enabled: scopeKey !== undefined,
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
};
