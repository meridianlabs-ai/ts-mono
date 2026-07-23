import { hashKey, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";
import type { SortingState } from "@tanstack/react-table";
import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  Condition,
  OrderByModel,
  Pagination,
} from "@tsmono/inspect-common/query";
import { useDebouncedCallback } from "@tsmono/react/hooks";
import { loading, type AsyncData } from "@tsmono/util";

import type { Cursor } from "../../../client/database/listing";
import type { LogListingRow, LogsListingMatch } from "../../../log_data";
import {
  databaseLogsListingKey,
  listingKeyUniverse,
  readLogsListingMatches,
  readLogsListingPage,
} from "../../../log_data";

import { applyListingQuery } from "./applyListingQuery";
import { createListingPlan } from "./planner";
import type {
  FilterTypeAccessor,
  LogsListingResult,
  ValueAccessor,
  ValueComparator,
} from "./types";

/** TanStack `SortingState` → API `OrderBy[]`. Mirrors scout's helper. */
export const sortingStateToOrderBy = (sorting: SortingState): OrderByModel[] =>
  sorting.map((s) => ({ column: s.id, direction: s.desc ? "DESC" : "ASC" }));

interface UseLogsListingParams<TRow> {
  /** Shaped rows (the panel owns shaping; sourced from the logs-content cache). */
  rows: TRow[];
  filter?: Condition;
  orderBy?: OrderByModel[];
  pagination?: Pagination;
  getValue: ValueAccessor<TRow>;
  getComparator: (columnId: string) => ValueComparator | undefined;
  getFilterType?: FilterTypeAccessor;
}

/**
 * The generic in-memory listing query: filter + sort + paginate over the
 * rows. Mirrors scout's `getTranscripts(filter, orderBy, pagination)` tail
 * and response shape. Retained for samples listings, which don't have a
 * database-backed path yet — the log list uses
 * {@link useDatabaseLogsListingQuery}.
 */
export function useLogsListingQuery<TRow>({
  rows,
  filter,
  orderBy,
  pagination,
  getValue,
  getComparator,
  getFilterType,
}: UseLogsListingParams<TRow>): LogsListingResult<TRow> {
  return useMemo(
    () =>
      applyListingQuery(rows, {
        filter,
        orderBy,
        pagination,
        getValue,
        getComparator,
        getFilterType,
      }),
    [rows, filter, orderBy, pagination, getValue, getComparator, getFilterType]
  );
}

/** The listing source a view queries — shared by the row query, the find
 *  band's match query, and (eventually) the offset lookup, so they can
 *  never disagree about the row universe. */
export interface LogsListingDescriptor<TRow> {
  /** The synced directory whose rows are the source (see `readLogsListing`
   *  for where they're read from). */
  logDir: string;
  /** Row-universe scan prefix (folder mode lists a subdirectory). */
  prefix: string;
  /** Cache identity of the row universe: everything `toRow` reads beyond
   *  the record itself (view mode, directory, display toggles).
   *  `undefined` while the scope is still hydrating — disables queries. */
  universe: string | undefined;
  /** Shape a source record into the view's row, or `undefined` when the
   *  view has no row for it (row-universe membership). */
  toRow: (log: LogListingRow) => TRow | undefined;
}

interface UseDatabaseLogsListingParams<TRow> {
  filter?: Condition;
  orderBy?: OrderByModel[];
  getValue: ValueAccessor<TRow>;
  getComparator: (columnId: string) => ValueComparator | undefined;
  getFilterType?: FilterTypeAccessor;
  /** Cache identity of the accessors above (see `useLogListColumns`) — the
   *  score-column schema lands asynchronously and changes what the plan
   *  computes, so it must key the query alongside filter/orderBy. */
  accessorsKey: string;
  listing: LogsListingDescriptor<TRow>;
}

/**
 * Rows per page. Scout's tuning (see `apps/scout/src/app/transcripts/
 * constants.ts` for the full derivation): page-fetch duration is mostly
 * fixed overhead, so large pages mean fewer fetches and fewer stall
 * opportunities — 500 rows ≈ 14,500px ≈ 10s of fast scrolling per page,
 * against the grid's 2,000px fetch threshold.
 */
const kLogsListingPageSize = 500;

/** {@link useDatabaseLogsListingQuery}'s result: the flattened page window
 *  plus the paging controls the grid's scroll trigger drives. */
export interface DatabaseLogsListing<TRow> {
  /** What to render. A settled failure reports here only when there is
   *  nothing to show (cold — typically the universe's first read failing):
   *  react-query retains the loaded pages across a failed refetch, and
   *  `placeholderData` carries the previous rows across a re-filter, so
   *  those keep serving as `data` (warm) with the failure surfaced through
   *  `error` beside them. */
  result: AsyncData<LogsListingResult<TRow>>;
  /** The last read failed — set for warm and cold failures alike (see
   *  `result`). Sticky once sync settles (focus/reconnect refetches are
   *  off); recovery is an invalidation (`invalidateDatabaseLogsListings`),
   *  a scroll-driven `fetchNextPage`, or a filter/sort change. */
  error: Error | undefined;
  /** More pages exist beyond the loaded window. */
  hasNextPage: boolean;
  /** Load the next page. In-flight-safe: a scroll burst never restarts an
   *  ongoing page fetch (`cancelRefetch: false`, like scout). */
  fetchNextPage: () => void;
  /** Ensure the head-first page window covers a snapshot offset. Used by
   *  Find to materialize an unloaded match without guessing from row
   *  counts (pages may contain dropped holes). */
  ensureOffsetLoaded: (offset: number) => void;
  /** A chained (commit-driven) fetch can't make progress right now, so the
   *  grid must pause its after-commit near-end check: after a settled error
   *  it would tight-loop the failing request — the fetch's own re-render
   *  commits with the near-end condition still true, chaining unboundedly.
   *  Scroll-driven fetches stay live (they are the retry path out of an
   *  error). */
  autoFetchPaused: boolean;
}

/**
 * The log listing query: a react-query `useInfiniteQuery` over
 * `readLogsListingPage` — pages compose over the tier-1 key-list snapshot
 * (built once per (universe, accessors, filter, orderBy), shared by every
 * page, invalidated by the write path's throttled root-key invalidation).
 * Rows are read from the listing source (IndexedDB in dir mode; db-less and
 * cache-only scopes fall back to the react-query cache inside the same
 * queryFn) and shaped per view inside the queryFn, so the full row list
 * never has to live in memory for the grid's sake. Results are asynchronous
 * by design: the first read shows whatever has replicated so far, and the
 * write path's throttled invalidation streams further rows in as they land
 * (refetching both tiers; `placeholderData` prevents blanking). `loading`
 * covers hydration and the universe's first read; within one universe a
 * re-filter/sort reports the previous result as `data` (no loading flash)
 * until the new read lands.
 */
export function useDatabaseLogsListingQuery<TRow>({
  filter,
  orderBy,
  getValue,
  getComparator,
  getFilterType,
  accessorsKey,
  listing,
}: UseDatabaseLogsListingParams<TRow>): DatabaseLogsListing<TRow> {
  const { logDir, prefix, universe, toRow } = listing;
  const queryKey = useMemo(
    () => databaseLogsListingKey(universe, accessorsKey, filter, orderBy),
    [universe, accessorsKey, filter, orderBy]
  );
  // The pending ensure-offset request, tagged with the query it was issued
  // against by key *value* (react-query's own hash), not input references:
  // `filter`/`orderBy` get fresh identities from unrelated grid-state
  // patches (e.g. persisting a selection re-derives `sorting ?? []`), and a
  // reference guard would cancel an in-flight load-through over a no-op
  // change.
  const [offsetRequest, setOffsetRequest] = useState<{
    offset: number;
    keyHash: string;
  }>();
  const queryKeyHash = useMemo(() => hashKey(queryKey), [queryKey]);

  // Flatten the page window into the result shape consumers already read.
  // Every page reports the snapshot's total_count; page 0 is the freshest
  // after a partial refetch. Passed as a stable `select` so react-query
  // memoizes the flattening (a per-render flatMap would give consumers a
  // fresh items identity every render).
  const select = useCallback(
    (
      data: InfiniteData<LogsListingResult<TRow>, Cursor | null>
    ): LogsListingResult<TRow> => ({
      items:
        data.pages.length === 1
          ? (data.pages[0]?.items ?? [])
          : data.pages.flatMap((page) => page.items),
      total_count: data.pages[0]?.total_count ?? 0,
      universe_task_ids: data.pages[0]?.universe_task_ids,
      next_cursor: data.pages.at(-1)?.next_cursor ?? null,
    }),
    []
  );

  const {
    data,
    isError,
    error,
    hasNextPage,
    fetchNextPage,
    isFetching,
    isPlaceholderData,
  } = useInfiniteQuery({
    queryKey,
    queryFn: ({
      pageParam,
    }: {
      pageParam: Cursor | null;
    }): Promise<LogsListingResult<TRow>> =>
      readLogsListingPage(
        {
          logDir,
          prefix,
          toRow,
          universe,
          accessorsKey,
          filter,
          orderBy,
          plan: createListingPlan({
            filter,
            orderBy,
            getValue,
            getComparator,
            getFilterType,
          }),
        },
        { cursor: pageParam, limit: kLogsListingPageSize }
      ),
    initialPageParam: null as Cursor | null,
    getNextPageParam: (lastPage) => lastPage.next_cursor,
    // Deliberately no `maxPages`: react-query drops capped pages off the
    // *front*, and with no `getPreviousPageParam`/scroll-up trigger the
    // head rows would be unrecoverable while the window slides under the
    // scroll position. A cap also wins no memory while the react-query
    // logs mirror still holds every row (plan doc, step 7) — bounded
    // windows arrive with the range-driven page queries sketched there.
    select,
    enabled: universe !== undefined,
    // Keep showing the previous result across re-filters/sorts — and schema
    // arrivals — within one universe (same row set, possibly re-evaluated);
    // a different universe's rows must not leak in.
    placeholderData: (previousData, previousQuery) =>
      universe !== undefined &&
      previousQuery !== undefined &&
      listingKeyUniverse(previousQuery.queryKey) === universe
        ? previousData
        : undefined,
    staleTime: 0,
    // The page window is a copy per recent (schema, filter, orderBy)
    // combination — unbounded until the range-driven rework, so scrolled
    // dirs can park deep windows here. Drop unobserved ones fast (the
    // snapshot has its own short gcTime — see readLogsListingPage).
    gcTime: 30_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const fetchNext = useCallback(() => {
    // Fire-and-forget: page arrival/errors surface through the query state.
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    fetchNextPage({ cancelRefetch: false });
  }, [fetchNextPage]);

  const ensureOffsetLoaded = useCallback(
    (offset: number) => {
      if (!Number.isInteger(offset) || offset < 0) return;
      setOffsetRequest({ offset, keyHash: queryKeyHash });
    },
    [queryKeyHash]
  );

  // The first snapshot offset the loaded pages don't cover (`next_cursor`
  // indexes the snapshot key list): `Infinity` once the whole snapshot is
  // loaded, `undefined` until the key's own data lands — a placeholder is
  // another query's window, so coverage must never be read off it. Also
  // the effect's progress trigger: booleans like "covered" can hold their
  // value across a fast page fetch and stall the chain.
  const uncoveredFrom =
    data === undefined || isPlaceholderData
      ? undefined
      : (data.next_cursor?.offset ?? Infinity);

  // Render-time state adjustment (not an effect — see the React docs'
  // setState-during-render form): drop a request that is stale (issued
  // against another query — it must not resume if that query's inputs
  // recur, e.g. a scope switch and back) or satisfied (a later snapshot
  // rebuild could otherwise re-activate it long after Find moved on). A
  // settled error keeps the request: an invalidation may heal the query,
  // and the effect below then resumes the chain.
  if (
    offsetRequest !== undefined &&
    (offsetRequest.keyHash !== queryKeyHash ||
      (uncoveredFrom !== undefined && uncoveredFrom > offsetRequest.offset))
  ) {
    setOffsetRequest(undefined);
  }

  useEffect(() => {
    if (
      offsetRequest === undefined ||
      uncoveredFrom === undefined ||
      uncoveredFrom > offsetRequest.offset ||
      isFetching ||
      isError
    ) {
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    fetchNextPage({ cancelRefetch: false });
  }, [offsetRequest, uncoveredFrom, isFetching, isError, fetchNextPage]);

  // Prefer retained rows over a settled error (`error` still reports beside
  // them): replacing a rendered list because one refetch failed would lose
  // the user's place over a failure a later invalidation may well heal.
  const result = useMemo<AsyncData<LogsListingResult<TRow>>>(() => {
    if (data !== undefined) return { data, loading: false };
    if (isError) return { error, loading: false };
    return loading;
  }, [data, isError, error]);

  return useMemo(
    () => ({
      result,
      error: error ?? undefined,
      hasNextPage,
      fetchNextPage: fetchNext,
      ensureOffsetLoaded,
      autoFetchPaused: isError,
    }),
    [result, error, hasNextPage, fetchNext, ensureOffsetLoaded, isError]
  );
}

interface UseLogsListingMatchesParams<TRow> {
  /** The same query inputs the row query ran under (pass them through from
   *  `useLogListData` rather than re-deriving — the match membership must
   *  never disagree with the rendered rows). */
  filter?: Condition;
  orderBy?: OrderByModel[];
  getValue: ValueAccessor<TRow>;
  getComparator: (columnId: string) => ValueComparator | undefined;
  getFilterType?: FilterTypeAccessor;
  accessorsKey: string;
  listing: LogsListingDescriptor<TRow>;
  /** The live find term. The query runs under a debounced copy: every
   *  distinct term is a fresh scan of the listing source, so keystrokes
   *  coalesce here while the input (and cheap overlay matching) stay live. */
  term: string;
  /** Whether the find band is open — the query never runs while closed. */
  enabled: boolean;
  getRowId: (row: TRow) => string;
  /** A row's searchable text, already lowercased (see `rowSearchText`). */
  rowText: (row: TRow) => string;
  /** Cache identity of `rowText` — the searchable (visible) column ids. */
  searchKey: readonly string[];
}

export interface LogsListingMatches {
  /** File-row matches in snapshot order, including their page offsets. */
  matches: LogsListingMatch[] | undefined;
  /** `matches` is a real result for the live term under the current universe —
   *  debounce flushed, not pending, not another key's placeholder, not an
   *  error. Only then may the UI claim "no results". */
  settled: boolean;
  /** Cancel the pending debounce and clear the match term (band closed). */
  reset: () => void;
}

/**
 * The find band's data-level match query, beside the row query so the two
 * share key shape and universe semantics: the key is the row query's key
 * (same universe slot, so `listingKeyUniverse` and the root invalidation
 * cover both) extended with the find-only inputs, and the placeholder keeps
 * previous matches only within one universe — folder-mode row ids are
 * basenames, so another directory's ids could otherwise mark unrelated
 * same-named rows as matches while a scope change's refetch is in flight.
 */
export function useLogsListingMatches<TRow>({
  filter,
  orderBy,
  getValue,
  getComparator,
  getFilterType,
  accessorsKey,
  listing,
  term,
  enabled,
  getRowId,
  rowText,
  searchKey,
}: UseLogsListingMatchesParams<TRow>): LogsListingMatches {
  const [matchTerm, setMatchTerm] = useState("");
  // Same 100ms as the shared FindBand's debounce. The debounced callback
  // always runs the latest closure, so the flush reads the current term.
  const syncMatchTerm = useDebouncedCallback(() => setMatchTerm(term), 100);
  useEffect(() => {
    syncMatchTerm();
  }, [term, syncMatchTerm]);
  const reset = useCallback(() => {
    syncMatchTerm.cancel();
    setMatchTerm("");
  }, [syncMatchTerm]);

  const { logDir, prefix, universe, toRow } = listing;
  const query = useQuery({
    queryKey: [
      ...databaseLogsListingKey(universe, accessorsKey, filter, orderBy),
      "find",
      matchTerm,
      searchKey,
    ],
    queryFn: (): Promise<LogsListingMatch[]> =>
      readLogsListingMatches(
        {
          logDir,
          prefix,
          toRow,
          universe,
          accessorsKey,
          filter,
          orderBy,
          plan: createListingPlan({
            filter,
            orderBy,
            getValue,
            getComparator,
            getFilterType,
          }),
        },
        {
          pageSize: kLogsListingPageSize,
          term: matchTerm,
          getRowId,
          getOrderValue: getValue,
          rowText,
        }
      ),
    enabled: enabled && matchTerm !== "" && universe !== undefined,
    // Keep the previous matches while a keystroke's refetch is in flight —
    // within one universe only (see the docstring above).
    placeholderData: (
      previousData: LogsListingMatch[] | undefined,
      previousQuery
    ) =>
      universe !== undefined &&
      previousQuery !== undefined &&
      listingKeyUniverse(previousQuery.queryKey) === universe
        ? previousData
        : undefined,
    staleTime: 0,
    // Transitional (pre-pagination): every distinct term parks a full id
    // list per key; drop unobserved ones fast, like the row query.
    gcTime: 30_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  return {
    matches: query.data,
    // `isPending` alone can't gate "no results": a key change served from
    // the placeholder reads as success while the new term's scan is still
    // in flight, and an errored query reads as not-pending with no data.
    settled:
      term === matchTerm &&
      !query.isPending &&
      !query.isPlaceholderData &&
      !query.isError,
    reset,
  };
}
