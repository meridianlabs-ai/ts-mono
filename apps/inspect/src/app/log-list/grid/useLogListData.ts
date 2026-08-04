import type { SortingState } from "@tanstack/react-table";
import { useMemo } from "react";

import type { Condition, OrderByModel } from "@tsmono/inspect-common/query";
import type { ColumnFilter } from "@tsmono/inspect-components/columnFilter";

import {
  applyListingQuery,
  compareByOrderBy,
  mergeSortedRows,
} from "../../../log_data";
import type {
  FilterTypeAccessor,
  LogListingRow,
  ValueAccessor,
  ValueComparator,
} from "../../../log_data";
import { useLogsListing } from "../../../state/hooks";
import { useKeyedMemo } from "../../shared/useKeyedMemo";
import { combineFilters } from "../listing/combineFilters";
import {
  sortingStateToOrderBy,
  useDatabaseLogsListingQuery,
  type LogsListingDescriptor,
} from "../listing/useLogsListingQuery";
import { FolderLogItem, PendingTaskItem } from "../LogItem";

import { LogListRow } from "./columns/types";
import { buildLogListRow } from "./logListRow";

const kNoRows: LogListRow[] = [];

/** Pending rows minus the tasks that already have a file row (pending row
 *  ids are task ids; file rows carry their record's task_id). `fileRows` is
 *  only the loaded page window under pagination, so the snapshot-scoped
 *  `universeTaskIds` carries the tasks whose files sit on unloaded pages;
 *  the window rows still count too — their bulkGot records can be fresher
 *  than the snapshot (e.g. a preview landing task_id after the scan). */
export const dropSettledPendingRows = (
  pendingRows: LogListRow[],
  fileRows: LogListRow[],
  universeTaskIds?: string[]
): LogListRow[] => {
  if (pendingRows.length === 0) return pendingRows;
  const fileTaskIds = new Set<string>(universeTaskIds);
  for (const row of fileRows) {
    const taskId = row.log?.task_id;
    if (taskId) fileTaskIds.add(taskId);
  }
  if (fileTaskIds.size === 0) return pendingRows;
  return pendingRows.filter((row) => !fileTaskIds.has(row.id));
};

interface UseLogListDataParams {
  /** Presentation rows with no database record: folders (pinned) and
   *  pending tasks (merged into the queried page as a sorted overlay).
   *  File rows come from the listing query below. */
  overlayItems: Array<FolderLogItem | PendingTaskItem>;
  /** Per-scope sorting/filters are read under this key (`undefined` while
   *  logDir is still hydrating — defaults apply, nothing is written). */
  scopeKey?: string;
  /** Row-universe membership as conditions over record columns
   *  (`parent_dir`, `retried` — built in LogsPanel). ANDed with the user's
   *  column filters for the data queries only: overlay rows (pending
   *  tasks) have no record, so record-column terms would drop them all. */
  scopeFilter?: Condition;
  getValue: ValueAccessor<LogListRow>;
  getComparator: (columnId: string) => ValueComparator | undefined;
  getFilterType?: FilterTypeAccessor;
  /** Cache identity of the column schema (see `useLogListColumns`). */
  accessorsKey: string;
  /** Shape a queried record into its display row (`undefined`: the view
   *  can't shape it — a shaping guard, the conditions exclude such records
   *  anyway). Pages come back as records; shaping runs here, above the
   *  data interface, per loaded page. */
  shapeRow: (log: LogListingRow) => LogListRow | undefined;
  listing: LogsListingDescriptor<LogListingRow>;
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
  /** The compiled query inputs derived from them — passed through for the
   *  find band's match query, so its membership can't drift from the rows
   *  via a second derivation. */
  filter?: Condition;
  orderBy: OrderByModel[];
  /** The listing query has no result to show yet (first read in flight). */
  pending: boolean;
  /** The listing read failed. Warm — `rows` still carries the retained
   *  pages (see `DatabaseLogsListing.result`) plus overlay items — so keep
   *  rendering the list and surface this beside it; only when `rows` is
   *  empty is there nothing to show (render an error state rather than an
   *  empty-looking list). */
  error: Error | undefined;
  /** More file rows exist beyond the loaded pages — gates the grid's
   *  scroll-near-end fetch trigger. */
  hasMoreRows: boolean;
  /** Load the next page of file rows (in-flight-safe). */
  fetchMoreRows: () => void;
  /** Load pages until a snapshot offset is represented in `rows`. */
  ensureFileOffsetLoaded: (offset: number) => void;
  /** Pause the grid's commit-driven fetch chaining — a chained fetch can't
   *  make progress right now (see `DatabaseLogsListing.autoFetchPaused`). */
  autoFetchPaused: boolean;
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
  scopeFilter,
  getValue,
  getComparator,
  getFilterType,
  accessorsKey,
  shapeRow,
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
  const userFilter = useMemo(
    () => combineFilters(columnFilters),
    [columnFilters]
  );
  // What the data queries run under: membership AND the user's filters.
  const filter = useMemo(() => {
    if (scopeFilter && userFilter) return scopeFilter.and(userFilter);
    return scopeFilter ?? userFilter;
  }, [scopeFilter, userFilter]);

  const {
    result: { data: result, loading: pending },
    error,
    hasNextPage,
    fetchNextPage,
    ensureOffsetLoaded,
    autoFetchPaused,
  } = useDatabaseLogsListingQuery<LogListingRow>({
    filter,
    orderBy,
    accessorsKey,
    listing,
  });

  // Pages arrive as stored records; shape them into display rows here,
  // above the data interface — per loaded page, per shaping inputs.
  const fileRows = useMemo(() => {
    const records = result?.items;
    if (records === undefined || records.length === 0) return kNoRows;
    const rows: LogListRow[] = [];
    for (const record of records) {
      const row = shapeRow(record);
      if (row !== undefined) rows.push(row);
    }
    return rows;
  }, [result, shapeRow]);

  // The pending anti-join input (overview.taskIds) and the file rows are two
  // independent async reads of the same store, so a settle-order skew can
  // briefly keep a task's pending row while its first log file already
  // renders. Re-derive against the queried page: a task with a file row is
  // not pending, whatever the overview's snapshot said.
  const visiblePendingRows = useMemo(
    () =>
      dropSettledPendingRows(pendingRows, fileRows, result?.universe_task_ids),
    [pendingRows, fileRows, result]
  );

  // Pending tasks have no database record: run the same query over them in
  // memory and merge the (small) result into the query's page. Under the
  // USER filter only — the scope conditions test record columns a pending
  // row doesn't have (its membership is the anti-join above).
  const overlay = useMemo(
    () =>
      visiblePendingRows.length === 0
        ? undefined
        : applyListingQuery(visiblePendingRows, {
            filter: userFilter,
            orderBy,
            getValue,
            getComparator,
            getFilterType,
          }),
    [
      visiblePendingRows,
      userFilter,
      orderBy,
      getValue,
      getComparator,
      getFilterType,
    ]
  );

  const files = useMemo(() => {
    if (!overlay) return fileRows;
    const compare =
      orderBy.length > 0
        ? compareByOrderBy(orderBy, getValue, getComparator)
        : undefined;
    return mergeSortedRows(fileRows, overlay.items, compare);
  }, [fileRows, overlay, orderBy, getValue, getComparator]);

  const rows = useMemo(
    () => (folders.length > 0 ? [...folders, ...files] : files),
    [folders, files]
  );

  return {
    rows,
    // Footer count over the whole filtered universe, not the loaded pages:
    // total_count comes from the snapshot's key list.
    filteredCount:
      folders.length + (result?.total_count ?? 0) + (overlay?.total_count ?? 0),
    sorting,
    columnFilters,
    filter,
    orderBy,
    pending,
    error,
    hasMoreRows: hasNextPage,
    fetchMoreRows: fetchNextPage,
    ensureFileOffsetLoaded: ensureOffsetLoaded,
    autoFetchPaused,
  };
};
