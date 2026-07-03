import { ClientAPI, LogDetails } from "../client/api/types";

import { fetchEngine } from "./fetchEngine";
import { fetchLog, initLogData } from "./replicationControl";
import { refreshLogListing } from "./useLogsSync";

/**
 * The imperative surface of the log-data acquisition subsystem — the minimal
 * set of non-hook entry points consumed outside `log_data`. Everything else
 * consumers do is declarative hook subscription (see
 * design/migration/domain-ownership.md). Growing this interface is a design
 * decision, not a convenience.
 */
export interface ImperativeLogData {
  /** Composition-root wiring of the api + database-service singleton —
   *  the subsystem's *initialize* verb, called once from `initializeStore`. */
  init(api: ClientAPI): void;
  /** User-priority details fetch — the queryFn behind the selected-log
   *  query. */
  fetchLog(logDir: string, logFile: string): Promise<LogDetails>;
  /** Invalidate the listing-sync queries (external freshness events / user
   *  refresh) — the subsystem's *invalidate* verb. */
  refreshLogListing(): Promise<void>;
  /** Clear all locally persisted log data (database + cache) — user-initiated
   *  maintenance from the viewer options popover. */
  clearData(): void;
}

export const imperativeLogData: ImperativeLogData = {
  init: initLogData,
  fetchLog,
  refreshLogListing,
  clearData: () => fetchEngine.clearData(),
};
