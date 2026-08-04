import type {
  Condition,
  OrderByModel,
  Pagination,
} from "@tsmono/inspect-common/query";
import { createLogger, throttle } from "@tsmono/util";

import { queryClient } from "../state/queryClient";

import { bumpLogsListingEpoch } from "./logsListingEpoch";

const log = createLogger("databaseListings");

export const databaseLogsListingKeyRoot = [
  "log_data",
  "dexie-listing",
  "logs",
] as const;

export const databaseLogsListingKey = (
  scopeKey: string | undefined,
  accessorsKey: string,
  filter?: Condition,
  orderBy?: OrderByModel[],
  pagination?: Pagination
) =>
  [
    ...databaseLogsListingKeyRoot,
    scopeKey ?? null,
    accessorsKey,
    filter ?? null,
    orderBy ?? null,
    pagination ?? null,
  ] as const;

/** The scope slot of a {@link databaseLogsListingKey} — for same-scope
 *  checks (placeholders) without hard-coding the key shape at call sites. */
export const listingKeyScope = (queryKey: readonly unknown[]): unknown =>
  queryKey[databaseLogsListingKeyRoot.length];

// The serialized invalidation loop's state: writes mark the listing family
// dirty; one loop instance drains the marker. Module-level singletons, like
// the epoch they guard.
let listingDirty = false;
let loopRunning = false;

const listingFetchCount = (): number =>
  queryClient.isFetching({ queryKey: databaseLogsListingKeyRoot });

/** Resolve once no listing-family fetch is in flight. Subscription-driven
 *  (no polling); the caller re-checks synchronously in its continuation, so
 *  a fetch starting between resolve and continuation just loops back into
 *  another wait. */
const waitForListingIdle = async (): Promise<void> => {
  while (listingFetchCount() > 0) {
    await new Promise<void>((resolve) => {
      const unsubscribe = queryClient.getQueryCache().subscribe(() => {
        if (listingFetchCount() === 0) {
          unsubscribe();
          resolve();
        }
      });
    });
  }
};

/** An ACTIVE listing query settled in error — the loop parks rather than
 *  chaining retries of a failing read (the same tight-loop hazard the
 *  grid's `autoFetchPaused` guards). Inactive errored queries (an old
 *  filter's, awaiting gc) must not park the loop for a healthy view. */
const activeListingErrored = (): boolean =>
  queryClient
    .getQueryCache()
    .findAll({ queryKey: databaseLogsListingKeyRoot, type: "active" })
    .some((query) => query.state.status === "error");

/**
 * Drain the dirty marker: each round waits for every in-flight listing
 * fetch to settle (never cancelling — an invalidation must not demote an
 * in-flight `fetchNextPage` into a pages-refetch that discards its page),
 * then bumps the snapshot epoch and awaits one invalidation/refetch. A
 * write landing during the refetch re-marks dirty and the loop runs
 * another round, so the final state always reflects the last write —
 * the skipped-refetch staleness `cancelRefetch: false` alone allowed.
 *
 * Bumping only at idle is also what keeps retained pages coherent: every
 * page of a multi-page refetch reads one snapshot epoch, so a committed
 * result can never splice two orderings (duplicate/missing rows). The
 * bump-to-invalidate step is synchronous — no await between them for a
 * fetch to sneak into.
 *
 * Parks (dirty retained, loop exits) when an active listing query settled
 * in error: chaining refetches of a failing read would spin. Retry arrives
 * with the next write's kick or the error banner's manual invalidation.
 */
const runInvalidationLoop = async (): Promise<void> => {
  if (loopRunning) {
    return;
  }
  loopRunning = true;
  try {
    while (listingDirty) {
      await waitForListingIdle();
      listingDirty = false;
      bumpLogsListingEpoch();
      await queryClient.invalidateQueries(
        { queryKey: databaseLogsListingKeyRoot },
        // Belt and braces for a fetch racing the idle check: reuse it
        // rather than demoting it (the loop's next round refreshes).
        { cancelRefetch: false }
      );
      if (activeListingErrored()) {
        listingDirty = true;
        return;
      }
    }
  } finally {
    loopRunning = false;
  }
};

/**
 * Coalesce replication bursts into at most one loop kick per second. A
 * throttle, not a debounce: the flush loops can write back-to-back for a
 * whole sync, and a trailing-only debounce would postpone the invalidation
 * for the entire burst instead of updating incrementally. The loop itself
 * (see {@link runInvalidationLoop}) serializes refetches against in-flight
 * listing fetches and re-runs while writes keep marking it dirty, so the
 * throttle only paces how often an idle system starts a round.
 */
const kickInvalidationLoop: () => void = throttle(
  () => {
    runInvalidationLoop().catch((error: unknown) => {
      log.error("Listing invalidation loop failed:", error);
    });
  },
  1000,
  { leading: false }
);

/** Mark the listing family dirty and (throttled) run the serialized
 *  invalidation loop. The write path's one entry point — see
 *  {@link runInvalidationLoop} for the ordering and staleness guarantees. */
export const invalidateDatabaseLogsListings = (): void => {
  listingDirty = true;
  kickInvalidationLoop();
};
