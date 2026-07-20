import type {
  Condition,
  OrderByModel,
  Pagination,
} from "@tsmono/inspect-common/query";
import { throttle } from "@tsmono/util";

import { queryClient } from "../state/queryClient";

export const databaseLogsListingKeyRoot = [
  "log_data",
  "dexie-listing",
  "logs",
] as const;

export const databaseLogsListingKey = (
  universe: string | undefined,
  accessorsKey: string,
  filter?: Condition,
  orderBy?: OrderByModel[],
  pagination?: Pagination
) =>
  [
    ...databaseLogsListingKeyRoot,
    universe ?? null,
    accessorsKey,
    filter ?? null,
    orderBy ?? null,
    pagination ?? null,
  ] as const;

/** The universe slot of a {@link databaseLogsListingKey} — for same-universe
 *  checks (placeholders) without hard-coding the key shape at call sites. */
export const listingKeyUniverse = (queryKey: readonly unknown[]): unknown =>
  queryKey[databaseLogsListingKeyRoot.length];

/**
 * Key of the tier-1 snapshot query: the ordered key list (+ count + inline
 * first page) one `(universe, accessors, filter, orderBy)` combination's page
 * queries compose over. Extends {@link databaseLogsListingKey} rather than
 * defining a new shape so the universe slot, `listingKeyUniverse`, and the
 * root-key invalidation cover it unchanged.
 */
export const databaseLogsListingSnapshotKey = (
  universe: string | undefined,
  accessorsKey: string,
  filter?: Condition,
  orderBy?: OrderByModel[]
) =>
  [
    ...databaseLogsListingKey(universe, accessorsKey, filter, orderBy),
    "snapshot",
  ] as const;

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
