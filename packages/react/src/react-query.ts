import { QueryClient, QueryKey } from "@tanstack/react-query";

import { ApiError, isRetryableHttpStatus } from "@tsmono/util";

declare global {
  // Set by e2e tests to skip retry delays

  var __TEST_DISABLE_RETRY: boolean | undefined;
}

export const defaultRetry = (failureCount: number, error: Error): boolean =>
  !globalThis.__TEST_DISABLE_RETRY &&
  failureCount < 3 &&
  !(error instanceof ApiError && !isRetryableHttpStatus(error.status));

export interface PushedQuerySource<T> {
  /**
   * What the query awaits. Returns the cached value if present; otherwise a
   * promise that stalls until the first `set`, so the query reports `loading`
   * like any other rather than being disabled with `skipToken`.
   */
  queryFn: () => T | Promise<T>;
  /** Write the value to the cache (the source of truth) and release the stall. */
  set: (value: T) => void;
}

/**
 * Backs a query whose data has no pull origin — it's pushed in over time (e.g.
 * host messages). The cache is the source of truth: `set` is the one
 * encapsulated writer (`setQueryData`, which also re-renders consumers), and
 * `queryFn` just reads the cache, stalling only until the first push. A passive
 * cache, plus a stall for data that has no honest empty default to show while
 * it waits.
 *
 * Caller contract: the cache is the only memory — no last-value is retained. If
 * the entry is ever evicted (react-query `gcTime` after the last observer
 * unmounts, or `removeQueries`), `queryFn` stalls again and waits for the next
 * `set`. So callers must `set` whenever the value should be present; after an
 * eviction the value reappears only on the next `set`, not automatically.
 */
export const makePushedQuerySource = <T>(
  client: QueryClient,
  queryKey: QueryKey
): PushedQuerySource<T> => {
  let stall: PromiseWithResolvers<T> | null = null;
  return {
    queryFn: () => {
      const cached = client.getQueryData<T>(queryKey);
      if (cached !== undefined) return cached;
      stall ??= Promise.withResolvers<T>();
      return stall.promise;
    },
    set: (value: T) => {
      client.setQueryData<T>(queryKey, value);
      stall?.resolve(value);
      stall = null;
    },
  };
};
