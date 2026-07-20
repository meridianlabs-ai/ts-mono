import type { SortingState } from "@tanstack/react-table";
import { useMemo } from "react";

import type { ColumnFilter } from "@tsmono/inspect-components/columnFilter";

import { useLogsListing } from "../../../state/hooks";
import { useKeyedMemo } from "../../shared/useKeyedMemo";
import {
  applyListingQuery,
  mergeSortedRows,
} from "../listing/applyListingQuery";
import { combineFilters } from "../listing/combineFilters";
import { compareByOrderBy } from "../listing/evaluator";
import type {
  FilterTypeAccessor,
  ValueAccessor,
  ValueComparator,
} from "../listing/types";
import {
  sortingStateToOrderBy,
  useDatabaseLogsListingQuery,
  type LogsListingDescriptor,
} from "../listing/useLogsListingQuery";
import { FolderLogItem, PendingTaskItem } from "../LogItem";

import { LogListRow } from "./columns/types";
import { buildLogListRow } from "./logListRow";

const kNoRows: LogListRow[] = [];

interface UseLogListDataParams {
  /** Presentation rows with no database record: folders (pinned) and
   *  pending tasks (merged into the queried page as a sorted overlay).
   *  File rows come from the listing query below. */
  overlayItems: Array<FolderLogItem | PendingTaskItem>;
  /** Per-scope sorting/filters are read under this key (`undefined` while
   *  logDir is still hydrating — defaults apply, nothing is written). */
  scopeKey?: string;
  getValue: ValueAccessor<LogListRow>;
  getComparator: (columnId: string) => ValueComparator | undefined;
  getFilterType?: FilterTypeAccessor;
  /** Cache identity of the accessors (see `useLogListColumns`). */
  accessorsKey: string;
  listing: LogsListingDescriptor<LogListRow>;
}

export interface LogListData {
  /** Display rows: folders pinned on top, then the filtered+sorted files. */
  rows: LogListRow[];
  /** Folders + matching files (reflects any active filter) — the footer
   *  count. */
  filteredCount: number;
  /** The sorting/filters the query ran under — the grid's controlled state,
   *  passed through so grid and query can't diverge. */
  sorting: SortingState;
  columnFilters?: Record<string, ColumnFilter>;
  /** The listing query has no result to show yet (first read in flight). */
  pending: boolean;
}

/**
 * The log-list data pipeline: run the scope's persisted sorting/filters as a
 * listing query against the listing source (IndexedDB in dir mode), shape the
 * resulting records into grid rows, merge in transient rows (pending tasks),
 * and pin folders on top. Called by LogsPanel; the grid just renders the
 * result.
 */
export const useLogListData = ({
  overlayItems,
  scopeKey,
  getValue,
  getComparator,
  getFilterType,
  accessorsKey,
  listing,
}: UseLogListDataParams): LogListData => {
  const { gridStateByScope } = useLogsListing();

  // Folders and pending tasks are presentation-only rows with no database
  // record; shape them here. Reuse the prior row object for any item whose
  // display inputs are unchanged, so only changed rows pay the rebuild.
  const overlayData: LogListRow[] = useKeyedMemo(
    overlayItems,
    (item) => item.id,
    (item) => [
      item.id,
      item.type,
      item.url,
      item.name,
      item.displayIndex,
      item.type === "folder" ? item.itemCount : undefined,
      item.type === "pending-task" ? item.model : undefined,
    ],
    (item) => buildLogListRow(item)
  );
  const { folders, pendingRows } = useMemo(() => {
    const folders: LogListRow[] = [];
    const pendingRows: LogListRow[] = [];
    for (const row of overlayData) {
      (row.type === "folder" ? folders : pendingRows).push(row);
    }
    return { folders, pendingRows };
  }, [overlayData]);

  // Persisted sort for this scope drives the listing query's orderBy.
  const sorting = useMemo<SortingState>(
    () => (scopeKey ? (gridStateByScope[scopeKey]?.sorting ?? []) : []),
    [gridStateByScope, scopeKey]
  );
  const orderBy = useMemo(() => sortingStateToOrderBy(sorting), [sorting]);

  // Per-scope column filters (persisted), AND-combined into one condition.
  const columnFilters = useMemo(
    () => (scopeKey ? gridStateByScope[scopeKey]?.columnFilters : undefined),
    [gridStateByScope, scopeKey]
  );
  const filter = useMemo(() => combineFilters(columnFilters), [columnFilters]);

  const { result, pending } = useDatabaseLogsListingQuery<LogListRow>({
    filter,
    orderBy,
    getValue,
    getComparator,
    getFilterType,
    accessorsKey,
    listing,
  });

  // Pending tasks have no database record: run the same query over them in
  // memory and merge the (small) result into the query's page.
  const overlay = useMemo(
    () =>
      pendingRows.length === 0
        ? undefined
        : applyListingQuery(pendingRows, {
            filter,
            orderBy,
            getValue,
            getComparator,
            getFilterType,
          }),
    [pendingRows, filter, orderBy, getValue, getComparator, getFilterType]
  );

  const files = useMemo(() => {
    const base = result?.items ?? kNoRows;
    if (!overlay) return base;
    const compare =
      orderBy.length > 0
        ? compareByOrderBy(orderBy, getValue, getComparator)
        : undefined;
    return mergeSortedRows(base, overlay.items, compare);
  }, [result, overlay, orderBy, getValue, getComparator]);

  const rows = useMemo(
    () => (folders.length > 0 ? [...folders, ...files] : files),
    [folders, files]
  );

  return {
    rows,
    filteredCount:
      folders.length + (result?.total_count ?? 0) + (overlay?.total_count ?? 0),
    sorting,
    columnFilters,
    pending,
  };
};
