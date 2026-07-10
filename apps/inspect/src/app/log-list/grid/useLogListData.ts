import type { SortingState } from "@tanstack/react-table";
import { useMemo } from "react";

import type { EvalScore, EvalSpec } from "@tsmono/inspect-common/types";
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
  useLogsListingQuery,
} from "../listing/useLogsListingQuery";
import { FileLogItem, FolderLogItem, PendingTaskItem } from "../LogItem";

import { LogListRow } from "./columns/types";

export type LogListItem = FileLogItem | FolderLogItem | PendingTaskItem;

const rowForItem = (item: LogListItem): LogListingRow | undefined =>
  item.type === "file" ? item.log : undefined;

const buildLogListRow = (item: LogListItem): LogListRow => {
  const log = rowForItem(item);
  const details = log?.header;
  // Headers are read from serialized logs; partial or older headers can
  // omit `eval` despite the generated type.
  const evalSpec = details?.eval as EvalSpec | undefined;

  // Compute total tokens across all models
  let totalTokens: number | undefined;
  if (details?.stats?.model_usage) {
    totalTokens = 0;
    for (const usage of Object.values(details.stats.model_usage)) {
      totalTokens += usage.total_tokens;
    }
  }

  // Compute duration in seconds
  let duration: number | undefined;
  if (details?.stats?.started_at && details.stats.completed_at) {
    const start = new Date(details.stats.started_at).getTime();
    const end = new Date(details.stats.completed_at).getTime();
    if (start && end && end > start) {
      duration = (end - start) / 1000;
    }
  }

  // Format task args. Prefer `task_args_passed` (the args the user
  // actually supplied at the call site) over `task_args` (which
  // would also include defaulted values).
  const taskArgsSource = evalSpec?.task_args_passed ?? evalSpec?.task_args;
  let taskArgs: string | undefined;
  if (taskArgsSource) {
    const entries = Object.entries(taskArgsSource);
    if (entries.length > 0) {
      taskArgs = entries
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(", ");
    }
  }

  // Percent of samples completed
  let percentCompleted: number | undefined;
  const total = details?.results?.total_samples;
  const completed = details?.results?.completed_samples;
  if (total && total > 0 && completed !== undefined) {
    percentCompleted = (completed / total) * 100;
  }

  // Sample facts are derived at ingestion and carried on the header.
  const sampleErrors = details?.sampleErrorCount;
  // Distinct limit types across samples in this task, comma-joined (already
  // sorted for stable text-filtering). Empty when no sample hit a limit.
  const sampleLimits =
    details !== undefined && details.sampleLimits.length > 0
      ? details.sampleLimits.join(", ")
      : undefined;

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
    sandbox: evalSpec?.sandbox?.type,
    totalTokens,
    duration,
    taskFile: evalSpec?.task_file ?? undefined,
    taskArgs,
    taskArgsRaw: taskArgsSource ?? undefined,
    tags: details?.tags,
    percentCompleted,
    sampleErrors,
    sampleLimits,
    errorMessage: details?.error?.message,
  };

  // Add individual scorer columns from results. Key by (scorer, metric)
  // so distinct scorers emitting the same metric name each get their own
  // column. Reducer is omitted from the key: `reducer=null` (default,
  // silently mean) and `reducer="mean"` (explicit) should land in the
  // same column since the underlying computation is identical.
  if (details?.results?.scores) {
    for (const evalScore of details.results.scores) {
      // Older logs can omit `metrics` despite the generated type.
      const metrics = evalScore.metrics as
        | EvalScore["metrics"]
        | null
        | undefined;
      if (metrics) {
        for (const [metricName, metric] of Object.entries(metrics)) {
          row[`score_${evalScore.name}/${metricName}`] = metric.value;
        }
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

  const { items: sortedFiles, total_count } = useLogsListingQuery({
    rows: files,
    filter,
    orderBy,
    getValue,
    getComparator,
    getFilterType,
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
