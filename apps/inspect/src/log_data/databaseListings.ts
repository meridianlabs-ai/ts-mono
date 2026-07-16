import type {
  Condition,
  OrderByModel,
  Pagination,
} from "@tsmono/inspect-common/query";
import { throttle } from "@tsmono/util";

import type { Log } from "../client/api/types";
import type { LogScope } from "../client/database";
import type {
  DatabaseListingPlan,
  DatabaseListingResult,
} from "../client/database/listing";
import { queryClient } from "../state/queryClient";

import { getDatabaseService } from "./databaseServiceInstance";

export const databaseLogsListingKeyRoot = [
  "log_data",
  "dexie-listing",
  "logs",
] as const;

export const databaseLogsListingKey = (
  view: string | undefined,
  filter: Condition,
  orderBy?: OrderByModel[],
  pagination?: Pagination
) =>
  [
    ...databaseLogsListingKeyRoot,
    view ?? null,
    filter,
    orderBy ?? null,
    pagination ?? null,
  ] as const;

export const databaseLogsOpened = (): boolean => getDatabaseService().opened();

export const readDatabaseLogsListing = async <TRow>(
  scope: LogScope,
  syncedPrefix: string,
  toRow: (log: Log) => TRow | undefined,
  plan: DatabaseListingPlan<TRow>
): Promise<DatabaseListingResult<TRow> | null> => {
  const database = getDatabaseService();
  const synced = await database.getSyncScope(syncedPrefix);
  return synced?.last_synced
    ? database.getLogsListing(scope, toRow, plan)
    : null;
};

/**
 * Coalesce replication bursts into at most one refetch of observed Dexie
 * listings per 100ms. A throttle, not a debounce: the flush loops can write
 * back-to-back for a whole sync, and a trailing-only debounce would postpone
 * the invalidation for the entire burst instead of updating incrementally.
 */
export const invalidateDatabaseLogsListings: () => void = throttle(
  () => {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    queryClient.invalidateQueries({
      queryKey: databaseLogsListingKeyRoot,
    });
  },
  100,
  { leading: false }
);
