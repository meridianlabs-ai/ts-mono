import { useAsyncDataFromQuery } from "@tsmono/react/hooks";
import { AsyncData } from "@tsmono/util";

import {
  databaseLogsListingKeyRoot,
  readSamplesLogFacts,
  type SamplesLogFacts,
} from "../../log_data";

/**
 * The samples page's log-side facts (see `readSamplesLogFacts`): sample-row
 * membership after retried-hiding, plus the task progress counts. Keyed
 * under the logs listing root — the facts read the logs table, so the write
 * path's throttled invalidation refreshes them alongside the other listing
 * projections.
 */
export const useSamplesLogFacts = (
  logDir: string,
  scopeDir: string,
  options: { showRetriedLogs: boolean }
): AsyncData<SamplesLogFacts> =>
  useAsyncDataFromQuery({
    queryKey: [
      ...databaseLogsListingKeyRoot,
      "samples-log-facts",
      logDir,
      scopeDir,
      options.showRetriedLogs,
    ],
    queryFn: () => readSamplesLogFacts(logDir, scopeDir, options),
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
