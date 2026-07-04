import { ClientAPI } from "../client/api/types";

import { fetchEngine } from "./fetchEngine";
import { invalidateLogDetail } from "./logDetailQuery";
import { initLogData } from "./replicationControl";
import { refreshLogListing } from "./useLogsSync";

/**
 * The imperative surface of the log-data acquisition subsystem — the minimal
 * set of non-hook entry points consumed outside `log_data`. Membership test:
 * a verb belongs here iff a human or external event issues it (*invalidate*
 * verbs, user commands, the composition root's *initialize*); a verb another
 * layer needs to run a mechanism is a mis-homed mechanism. Everything else
 * consumers do is declarative hook subscription (see
 * design/migration/domain-ownership.md). Growing this interface is a design
 * decision, not a convenience.
 */
export interface ImperativeLogData {
  /** Composition-root wiring of the api + database-service singleton —
   *  the subsystem's *initialize* verb, called once from `initializeStore`. */
  init(api: ClientAPI): void;
  /** Re-fetch one log's details (toolbar refresh / edit-save) — the
   *  log-detail *invalidate* verb. */
  invalidateLogDetail(
    logDir: string,
    logFile: string | undefined
  ): Promise<void>;
  /** Invalidate the listing-sync queries (external freshness events / user
   *  refresh) — the listing *invalidate* verb. */
  refreshLogListing(): Promise<void>;
  /** Clear all locally persisted log data (database + cache) — user-initiated
   *  maintenance from the viewer options popover. */
  clearData(): void;
}

export const imperativeLogData: ImperativeLogData = {
  init: initLogData,
  invalidateLogDetail,
  refreshLogListing,
  clearData: () => fetchEngine.clearData(),
};
