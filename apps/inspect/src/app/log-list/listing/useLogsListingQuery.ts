import { useQuery } from "@tanstack/react-query";
import type { SortingState } from "@tanstack/react-table";
import { useMemo } from "react";

import type {
  Condition,
  OrderByModel,
  Pagination,
} from "@tsmono/inspect-common/query";

import type { LogListingRow } from "../../../log_data";
import { databaseLogsListingKey, readLogsListing } from "../../../log_data";

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

interface UseDatabaseLogsListingParams<TRow> {
  filter?: Condition;
  orderBy?: OrderByModel[];
  pagination?: Pagination;
  getValue: ValueAccessor<TRow>;
  getComparator: (columnId: string) => ValueComparator | undefined;
  getFilterType?: FilterTypeAccessor;
  listing: {
    /** The synced directory whose rows are the source (see `readLogsListing`
     *  for where they're read from). */
    logDir: string;
    /** Row-universe scan prefix (folder mode lists a subdirectory). */
    prefix: string;
    /** Cache identity of the row universe: everything `toRow` reads beyond
     *  the record itself (view mode, directory, display toggles).
     *  `undefined` while the scope is still hydrating — disables the query. */
    universe: string | undefined;
    /** Shape a source record into the view's row, or `undefined` when the
     *  view has no row for it (row-universe membership). */
    toRow: (log: LogListingRow) => TRow | undefined;
  };
}

export interface DatabaseLogsListing<TRow> {
  /** The latest result for this universe (a placeholder from the previous
   *  filter/sort while a refetch is in flight); `undefined` until the
   *  universe's first read lands. */
  result: LogsListingResult<TRow> | undefined;
  /** No result to show yet — the universe is hydrating or its first read is
   *  in flight. Rows stream in via write-path invalidation after that. */
  pending: boolean;
}

/**
 * The log listing query: rows are read from the listing source (IndexedDB
 * in dir mode — see `readLogsListing`) and shaped per view inside the
 * queryFn, so the full row list never has to live in memory for the grid's
 * sake. Results are asynchronous by design: the first read shows whatever
 * has replicated so far, and the write path's throttled invalidation
 * streams further rows in as they land.
 */
export function useDatabaseLogsListingQuery<TRow>({
  filter,
  orderBy,
  pagination,
  getValue,
  getComparator,
  getFilterType,
  listing,
}: UseDatabaseLogsListingParams<TRow>): DatabaseLogsListing<TRow> {
  const { logDir, prefix, universe, toRow } = listing;
  const query = useQuery({
    queryKey: databaseLogsListingKey(universe, filter, orderBy, pagination),
    queryFn: (): Promise<LogsListingResult<TRow>> =>
      readLogsListing(
        logDir,
        prefix,
        toRow,
        createListingPlan({
          filter,
          orderBy,
          pagination,
          getValue,
          getComparator,
          getFilterType,
        })
      ),
    enabled: universe !== undefined,
    // Keep showing the previous result across re-filters/sorts within one
    // universe; a different universe's rows must not leak in.
    placeholderData: (previousData, previousQuery) =>
      universe !== undefined && previousQuery?.queryKey[3] === universe
        ? previousData
        : undefined,
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  return { result: query.data, pending: query.isPending };
}
