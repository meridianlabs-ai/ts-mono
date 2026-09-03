import { skipToken, useInfiniteQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo } from "react";

import {
  rowContainsMessage,
  type MessageRow,
} from "@tsmono/inspect-components/chat";
import { AsyncData, loading as asyncLoading } from "@tsmono/util";

import { SampleHandle } from "../app/types";

import { type EvalSampleData } from "./sampleData";
import { sampleMessagesSource } from "./sampleMessagesSource";
import { kSampleGcTimeMs } from "./sampleQuery";

/** Rows per page of a chunked sample's settled conversation read. */
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
export const unpagedFeed = (
  rows: AsyncData<MessageRow[]>
): MessageRowsFeed => ({
  rows,
  hasMore: false,
  loadMore: kNoLoadMore,
});

// one identity for every pending render — the returned feed is memoized so
// consumers' own memos (useSampleMessages) see a stable value
const kLoadingFeed = unpagedFeed(asyncLoading);

/**
 * The settled conversation's rows for a sample, read through react-query's
 * infinite query. Which feed backs them — inline monolith messages or the
 * windowed source over a chunked sample's conversation — is selected behind
 * the SampleMessagesData seam (`sampleMessagesSource`). Chunked samples
 * read in kMessageRowsPageSize pages, so the tab's first paint costs one
 * page even on a huge conversation and scrolling extends the loaded prefix
 * page by page; monolith samples serve the whole row space in one read,
 * exactly like the pre-paging feed — a TEMPORARY gate, because behaviors
 * built on a fully loaded list (find scope, the live-finish row swap)
 * aren't paging-aware yet and customers' non-chunked evals must not lose
 * them. Once those work over a paged prefix, the gate can drop. Pages are
 * forward-contiguous from row 0 (offset cursors); there is deliberately no
 * eviction — `maxPages` would punch holes in the flattened prefix the list
 * renders.
 *
 * Returns undefined while there is no settled conversation to read (a
 * live streaming sample, a sample still fetching, the Messages tab never
 * activated); a loading feed while the first page is materializing; the
 * caller owns what covers those states (streaming rows, waiting/loading
 * affordances).
 *
 * `targetMessageId` is a `?message=` deep link's target: pages drain in
 * serially until a loaded row renders that message (or the conversation
 * is exhausted), and the feed reports loading until then — the list
 * honors its initial scroll index at mount, so it must mount with the
 * target resident. The prefix cost is deliberate: pages are
 * forward-contiguous, so the covering prefix is the minimum the list can
 * render anyway.
 */
export const useMessageRows = (
  handle: SampleHandle | undefined,
  sampleData: EvalSampleData,
  activated: boolean,
  targetMessageId?: string | null
): MessageRowsFeed | undefined => {
  const source = sampleMessagesSource(sampleData);
  const paged = sampleData.chunked !== undefined;

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
              limit: paged ? kMessageRowsPageSize : Number.MAX_SAFE_INTEGER,
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

  const fetchNext = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      // cancelRefetch false: callers repeat freely (scroll handlers, the
      // drain effect) and a re-entrant call must not restart the in-flight
      // page; failures surface through the query's own error state
      fetchNextPage({ cancelRefetch: false }).catch(() => undefined);
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const targetLoaded = useMemo(
    () =>
      targetMessageId == null ||
      (rows?.some((row) => rowContainsMessage(row, targetMessageId)) ?? false),
    [rows, targetMessageId]
  );
  // eslint-disable-next-line tsmono/no-raw-use-effect -- baselined at rule introduction; migrate to a named hook or derived state
  useEffect(() => {
    // isError halts the drain: a failed page settles the query with
    // hasNextPage still true, and re-firing fetchNext would retry the same
    // page in an unbounded loop behind the error panel
    if (!targetLoaded && !isError) {
      fetchNext();
    }
    // `rows` is the re-fire key: a page can start AND land within one
    // committed render (in-memory sources resolve in a microtask), so
    // isFetchingNextPage never visibly flips and the other deps are
    // unchanged after each drained page.
  }, [rows, targetLoaded, isError, fetchNext]);

  const hasSource = source !== undefined;
  return useMemo(() => {
    if (!activated || !hasSource) {
      // idle even over a warm cache: rows are served only once the caller
      // activates the read and a settled feed exists
      return undefined;
    }
    if (isPending) {
      return kLoadingFeed;
    }
    if (isError) {
      // a failed page read fails the tab, matching the one-shot read's
      // behavior; the next loadMore after remount retries the same page
      return unpagedFeed({ error, loading: false });
    }
    if (!targetLoaded && hasNextPage) {
      // the deep-link target's covering prefix is still draining in; a
      // target the conversation never renders (hasNextPage exhausts) falls
      // through and mounts at the top, like any unresolved ?message=
      return kLoadingFeed;
    }
    return {
      rows: { data: rows ?? [], loading: false },
      hasMore: hasNextPage,
      loadMore: fetchNext,
    };
  }, [
    activated,
    hasSource,
    isPending,
    isError,
    error,
    targetLoaded,
    hasNextPage,
    rows,
    fetchNext,
  ]);
};
