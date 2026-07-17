import type { SortingState } from "@tanstack/react-table";
import { useCallback, useMemo } from "react";

import type { ColumnFilter } from "@tsmono/inspect-components/columnFilter";

import { LogListingRow } from "../../../log_data";
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
} from "../listing/useLogsListingQuery";
import { FileLogItem, FolderLogItem, PendingTaskItem } from "../LogItem";

import { LogListRow } from "./columns/types";

export type LogListItem = FileLogItem | FolderLogItem | PendingTaskItem;

const kNoRows: LogListRow[] = [];

const rowForItem = (item: LogListItem): LogListingRow | undefined =>
  item.type === "file" ? item.log : undefined;

// A projection, not a computation: every derived value is read off the row
// (attached at ingestion by `detailTier`/`deriveLogFields`) so the grid can
// never disagree with what the store holds.
const buildLogListRow = (item: LogListItem): LogListRow => {
  const log = rowForItem(item);
  const details = log?.header;
  const derived = log?.derived;

  const taskArgsSource =
    details?.eval?.task_args_passed ?? details?.eval?.task_args;

  const row: LogListRow = {
    id: item.id,
    name: item.name,
    displayIndex:
      item.type === "file" || item.type === "pending-task"
        ? item.displayIndex
        : undefined,
    type: item.type,
    url: item.url,
    task: item.type === "file" ? (log?.task ?? undefined) : item.name,
    model:
      item.type === "file"
        ? log?.model
        : item.type === "pending-task"
          ? item.model
          : undefined,
    modelRoles:
      item.type === "file" ? (log?.model_roles ?? undefined) : undefined,
    score: log?.primary_metric?.value,
    status: log?.status,
    completedAt: log?.completed_at,
    itemCount: item.type === "folder" ? item.itemCount : undefined,
    log: item.type === "file" ? item.log : undefined,
    path: item.type === "file" ? item.name : undefined,
    totalSamples: details?.results?.total_samples,
    completedSamples: details?.results?.completed_samples,
    sandbox: details?.eval?.sandbox?.type,
    totalTokens: derived?.total_tokens,
    duration: derived?.duration,
    taskFile: details?.eval?.task_file ?? undefined,
    taskArgs: derived?.task_args,
    taskArgsRaw: taskArgsSource ?? undefined,
    tags: details?.tags,
    percentCompleted: derived?.percent_completed,
    sampleErrors: details?.sampleErrorCount,
    sampleLimits: derived?.sample_limits,
    errorMessage: details?.error?.message,
  };

  // Individual scorer columns, keyed `score_<scorer>/<metric>`.
  if (derived?.scores) {
    for (const [scorerName, metrics] of Object.entries(derived.scores)) {
      for (const [metricName, value] of Object.entries(metrics)) {
        row[`score_${scorerName}/${metricName}`] = value;
      }
    }
  }

  return row;
};

interface UseLogListDataParams {
  /** Presentation items: folders (pinned) and pending tasks (merged in as an
   *  overlay — they have no database record). File items here are used only
   *  for counts; file ROWS come from the listing query below. */
  items: LogListItem[];
  /** Per-scope sorting/filters are read under this key (`undefined` while
   *  logDir is still hydrating — defaults apply, nothing is written). */
  scopeKey?: string;
  getValue: ValueAccessor<LogListRow>;
  getComparator: (columnId: string) => ValueComparator | undefined;
  getFilterType?: FilterTypeAccessor;
  /** The listing query's source description — see `useDatabaseLogsListingQuery`. */
  listing: {
    logDir: string;
    prefix: string;
    universe: string | undefined;
    toItem: (log: LogListingRow) => FileLogItem | undefined;
  };
}

export interface LogListData {
  /** Display rows: folders pinned on top, then the filtered+sorted files. */
  rows: LogListRow[];
  /** Pre-filter row count — distinguishes "no items yet" (loading
   *  empty-state) from "filters matched nothing". */
  totalRowCount: number;
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
  items,
  scopeKey,
  getValue,
  getComparator,
  getFilterType,
  listing,
}: UseLogListDataParams): LogListData => {
  const { gridStateByScope } = useLogsListing();

  // Folders and pending tasks are presentation-only rows with no database
  // record; shape them here. Reuse the prior row object for any item whose
  // display inputs are unchanged, so only changed rows pay the rebuild.
  const overlayItems = useMemo(
    () => items.filter((item) => item.type !== "file"),
    [items]
  );
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

  const toItem = listing.toItem;
  const toRow = useCallback(
    (log: LogListingRow): LogListRow | undefined => {
      const item = toItem(log);
      return item === undefined ? undefined : buildLogListRow(item);
    },
    [toItem]
  );

  const { result, pending } = useDatabaseLogsListingQuery<LogListRow>({
    filter,
    orderBy,
    getValue,
    getComparator,
    getFilterType,
    listing: {
      logDir: listing.logDir,
      prefix: listing.prefix,
      universe: listing.universe,
      toRow,
    },
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
    totalRowCount: items.length,
    filteredCount:
      folders.length + (result?.total_count ?? 0) + (overlay?.total_count ?? 0),
    sorting,
    columnFilters,
    pending,
  };
};
