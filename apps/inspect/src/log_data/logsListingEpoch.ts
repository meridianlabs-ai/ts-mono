/**
 * Invalidation epoch for the logs-listing data layer's internal caches.
 *
 * The write path bumps the epoch from `invalidateDatabaseLogsListings`'
 * serialized loop, which bumps only while NO listing fetch is in flight and
 * invalidates the react-query listing keys in the same synchronous step —
 * so every page of one in-flight pass reads one epoch's snapshot (a
 * mid-pass bump would splice two orderings into one committed window).
 * Every cached snapshot records the epoch it was built under and rebuilds
 * when it no longer matches. The required ordering — a refetch must never
 * be served the pre-write snapshot — holds by construction rather than by
 * call-site discipline, and per-view data instances need no registration
 * with the write path.
 */

let epoch = 0;

export const logsListingEpoch = (): number => epoch;

export const bumpLogsListingEpoch = (): void => {
  epoch += 1;
};
