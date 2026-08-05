import { skipToken, useInfiniteQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import type { MessageRow } from "@tsmono/inspect-components/chat";
import { AsyncData, loading as asyncLoading } from "@tsmono/util";

import { SampleHandle } from "../app/types";

import { type EvalSampleData } from "./sampleData";
import { sampleMessagesSource } from "./sampleMessagesSource";
import { kSampleGcTimeMs } from "./sampleQuery";

/** Rows per page of the settled conversation read. */
export const kMessageRowsPageSize = 100;

/**
 * The settled conversation as a loaded prefix of rows plus the controls to
 * extend it — what the Messages tab consumes. `rows.data` is every row
 * loaded so far (pages flattened); `hasMore` marks it a prefix; `loadMore`
 * requests the next page and no-ops while one is in flight, so scroll
 * handlers may call it freely.
 */
export interface MessageRowsFeed {
  rows: AsyncData<MessageRow[]>;
  hasMore: boolean;
  loadMore: () => void;
}

const kNoLoadMore = () => {};

/** A feed over rows that are already everything there is. */
export const unpagedFeed = (rows: AsyncData<MessageRow[]>): MessageRowsFeed => ({
  rows,
  hasMore: false,
  loadMore: kNoLoadMore,
});

/**
 * The settled conversation's rows for a sample, paged through react-query's
 * infinite query. Which feed backs them — inline monolith messages or the
 * windowed source over a chunked sample's conversation — is selected behind
 * the SampleMessagesData seam (`sampleMessagesSource`); both serve
 * kMessageRowsPageSize rows per read, so the tab's first paint costs one
 * page even on a huge conversation and scrolling extends the loaded prefix
 * page by page. Pages are forward-contiguous from row 0 (offset cursors);
 * there is deliberately no eviction — `maxPages` would punch holes in the
 * flattened prefix the list renders.
 *
 * Returns undefined while there is no settled conversation to read (a
 * live streaming sample, a sample still fetching, the Messages tab never
 * activated); a loading feed while the first page is materializing; the
 * caller owns what covers those states (streaming rows, waiting/loading
 * affordances).
 */
export const useMessageRows = (
  handle: SampleHandle | undefined,
  sampleData: EvalSampleData,
  activated: boolean
): MessageRowsFeed | undefined => {
  const source = sampleMessagesSource(sampleData);

  const query = useInfiniteQuery({
    // CONTRACT: the key omits the source because every source is a pure
    // function of the handle (logs are append-only; fold options are a
    // module constant) — that is what lets staleTime Infinity serve the
    // cached read forever, and why these pages are NEVER invalidated (a
    // refetch would re-read every loaded page). A source that breaks the
    // rule (per-user fold options) must add its distinguishing inputs here.
    queryKey: [
      "log_data",
      "message-rows",
      handle?.logFile ?? null,
      handle?.id ?? null,
      handle?.epoch ?? null,
    ],
    queryFn:
      activated && source && handle
        ? ({ pageParam }) =>
            source.getRows({
              cursor: pageParam === 0 ? null : { offset: pageParam },
              direction: "forward",
              limit: kMessageRowsPageSize,
            })
        : skipToken,
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextCursor?.offset,
    gcTime: kSampleGcTimeMs,
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    // MessageRows hold large resolved message graphs — never clone/merge.
    structuralSharing: false,
  });

  const {
    data,
    isPending,
    isError,
    error,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = query;
  const pages = data?.pages;
  const rows = useMemo(() => pages?.flatMap((page) => page.rows), [pages]);

  return useMemo(() => {
    if (!activated || source === undefined) {
      // idle even over a warm cache: rows are served only once the caller
      // activates the read and a settled feed exists
      return undefined;
    }
    if (isPending) {
      return unpagedFeed(asyncLoading);
    }
    if (isError) {
      // a failed page read fails the tab, matching the one-shot read's
      // behavior; the next loadMore after remount retries the same page
      return unpagedFeed({ error, loading: false });
    }
    return {
      rows: { data: rows ?? [], loading: false },
      hasMore: hasNextPage,
      loadMore: () => {
        if (hasNextPage && !isFetchingNextPage) {
          // cancelRefetch false: scroll handlers call this repeatedly and a
          // re-entrant call must not restart the in-flight page; failures
          // surface through the query's own error state
          fetchNextPage({ cancelRefetch: false }).catch(() => undefined);
        }
      },
    };
  }, [
    activated,
    source,
    isPending,
    isError,
    error,
    rows,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  ]);
};
