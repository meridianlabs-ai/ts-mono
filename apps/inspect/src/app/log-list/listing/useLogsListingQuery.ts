import type { SortingState } from "@tanstack/react-table";
import { useMemo } from "react";

import type {
  Condition,
  OrderByModel,
  Pagination,
} from "@tsmono/inspect-common/query";

import { applyListingQuery } from "./applyListingQuery";
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
 * The log listing query: filter + sort + paginate over the rows. Mirrors
 * scout's `getTranscripts(filter, orderBy, pagination)` tail and response shape.
 *
 * Client-side for now — a derived `useMemo` over the (reactive) rows. The async
 * data source already lives in the react-query logs-content cache; when inspect
 * moves filter/sort server-side this hook becomes a `useQuery` that fetches a
 * filtered/sorted page instead.
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
