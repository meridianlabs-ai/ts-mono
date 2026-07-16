import type {
  Condition,
  OrderByModel,
  Pagination,
} from "@tsmono/inspect-common/query";

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

let invalidationTimer: ReturnType<typeof setTimeout> | undefined;

/** Coalesce replication bursts into one refetch of observed Dexie listings. */
export const invalidateDatabaseLogsListings = (): void => {
  if (invalidationTimer !== undefined) clearTimeout(invalidationTimer);
  invalidationTimer = setTimeout(() => {
    invalidationTimer = undefined;
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    queryClient.invalidateQueries({ queryKey: databaseLogsListingKeyRoot });
  }, 100);
};
