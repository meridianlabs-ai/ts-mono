import { useQuery } from "@tanstack/react-query";
import type { SortingState } from "@tanstack/react-table";
import { useMemo } from "react";

import type {
  Condition,
  OrderByModel,
  Pagination,
} from "@tsmono/inspect-common/query";

import type { Log } from "../../../client/api/types";
import type { LogScope } from "../../../client/database";
import {
  databaseLogsListingKey,
  databaseLogsListingKeyRoot,
  databaseLogsOpened,
  readDatabaseLogsListing,
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
 * The log listing query: filter + sort + paginate over the rows. Mirrors
 * scout's `getTranscripts(filter, orderBy, pagination)` tail and response shape.
 *
 * The generic in-memory path is retained for samples and db-less listings.
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

interface UseDatabaseLogsListingParams<
  TRow,
> extends UseLogsListingParams<TRow> {
  database: {
    scope: LogScope;
    syncedPrefix: string;
    rowKey: (row: TRow) => string | undefined;
  };
}

/** Use Dexie for conditioned log listings, with the in-memory path as fallback. */
export function useDatabaseLogsListingQuery<TRow>({
  rows,
  filter,
  orderBy,
  pagination,
  getValue,
  getComparator,
  getFilterType,
  database,
}: UseDatabaseLogsListingParams<TRow>): LogsListingResult<TRow> {
  const databaseEnabled = filter !== undefined && databaseLogsOpened();
  const query = useMemo(
    () => ({
      filter,
      orderBy,
      pagination,
      getValue,
      getComparator,
      getFilterType,
    }),
    [filter, orderBy, pagination, getValue, getComparator, getFilterType]
  );

  const dexieResult = useQuery({
    queryKey: filter
      ? databaseLogsListingKey(
          database.scope.prefix,
          filter,
          orderBy,
          pagination
        )
      : [...databaseLogsListingKeyRoot, "disabled"],
    queryFn: async (): Promise<LogsListingResult<TRow> | null> => {
      if (!filter) return null;
      const byKey = new Map<string, TRow>();
      const transient: TRow[] = [];
      const position = new Map<TRow, number>();
      for (const [index, row] of rows.entries()) {
        position.set(row, index);
        const key = database.rowKey(row);
        if (key === undefined) transient.push(row);
        else byKey.set(key, row);
      }

      const plan = createListingPlan(
        transient.length > 0 ? { ...query, pagination: undefined } : query,
        (row) => position.get(row) ?? Number.MAX_SAFE_INTEGER
      );
      const result = await readDatabaseLogsListing(
        database.scope,
        database.syncedPrefix,
        (log: Log) => byKey.get(log.name),
        plan
      );
      if (result === null) return null;
      if (transient.length === 0) return result;
      const included = new Set([...result.items, ...transient]);
      return applyListingQuery(
        rows.filter((row) => included.has(row)),
        query
      );
    },
    enabled: databaseEnabled,
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey[3] === database.scope.prefix
        ? previousData
        : undefined,
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const databaseResult = databaseEnabled
    ? (dexieResult.data ?? undefined)
    : undefined;
  const fallbackResult = useMemo(
    () =>
      databaseResult === undefined ? applyListingQuery(rows, query) : undefined,
    [databaseResult, rows, query]
  );
  return databaseResult ?? fallbackResult!;
}
