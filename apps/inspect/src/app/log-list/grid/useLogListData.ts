import type { SortingState } from "@tanstack/react-table";
import { useMemo } from "react";

import type { ColumnFilter } from "@tsmono/inspect-components/columnFilter";

import { LogListingRow } from "../../../log_data";
import { useLogsListing } from "../../../state/hooks";
import { useKeyedMemo } from "../../shared/useKeyedMemo";
import { combineFilters } from "../listing/combineFilters";
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
  items: LogListItem[];
  /** Per-scope sorting/filters are read under this key (`undefined` while
   *  logDir is still hydrating — defaults apply, nothing is written). */
  scopeKey?: string;
  getValue: ValueAccessor<LogListRow>;
  getComparator: (columnId: string) => ValueComparator | undefined;
  getFilterType?: FilterTypeAccessor;
  databaseScope: { prefix: string; syncedPrefix: string };
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
}

/**
 * The log-list data pipeline: shape items into rows, apply the scope's
 * persisted sorting/filters via the listing query, and pin folders on top.
 * Called by LogsPanel (the panel owns shaping — see `useLogsListingQuery`);
 * the grid just renders the result.
 */
export const useLogListData = ({
  items,
  scopeKey,
  getValue,
  getComparator,
  getFilterType,
  databaseScope,
}: UseLogListDataParams): LogListData => {
  const { gridStateByScope } = useLogsListing();

  // Reuse the prior row object for any item whose display inputs (the Log
  // row, structural fields) are unchanged, so only changed rows pay the
  // per-row rebuild. Keyed on store references (which stay stable across
  // flushes for unchanged logs) rather than the `item` object, so it works
  // even though `items` is rebuilt each flush upstream.
  const data: LogListRow[] = useKeyedMemo(
    items,
    (item) => item.id,
    (item) => [
      item.id,
      item.type,
      item.url,
      item.name,
      item.displayIndex,
      rowForItem(item),
      item.type === "folder" ? item.itemCount : undefined,
      item.type === "pending-task" ? item.model : undefined,
    ],
    (item) => buildLogListRow(item)
  );

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

  // Folders (logs mode) are presentation: pinned on top, independent of sort.
  // Sort/filter/paginate runs over the file rows only.
  const { folders, files } = useMemo(() => {
    const folders: LogListRow[] = [];
    const files: LogListRow[] = [];
    for (const row of data) {
      (row.type === "folder" ? folders : files).push(row);
    }
    return { folders, files };
  }, [data]);

  const database = {
    scope: { prefix: databaseScope.prefix },
    syncedPrefix: databaseScope.syncedPrefix,
    rowKey: (row: LogListRow) =>
      row.type === "file" ? row.log?.name : undefined,
  };
  const { items: sortedFiles, total_count } = useDatabaseLogsListingQuery({
    rows: files,
    filter,
    orderBy,
    getValue,
    getComparator,
    getFilterType,
    database,
  });

  const rows = useMemo(
    () => (folders.length > 0 ? [...folders, ...sortedFiles] : sortedFiles),
    [folders, sortedFiles]
  );

  return {
    rows,
    totalRowCount: data.length,
    filteredCount: folders.length + total_count,
    sorting,
    columnFilters,
  };
};
