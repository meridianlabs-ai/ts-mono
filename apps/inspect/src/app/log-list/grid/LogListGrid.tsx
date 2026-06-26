import type { SortingState } from "@tanstack/react-table";
import clsx from "clsx";
import { FC, useCallback, useDeferredValue, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";

import type { SimpleCondition } from "@tsmono/inspect-common/query";
import type {
  ColumnFilter,
  FilterType,
} from "@tsmono/inspect-components/columnFilter";
import { useProperty } from "@tsmono/react/hooks";

import { LogDetails } from "../../../client/api/types";
import { useLogsListing } from "../../../state/hooks";
import { useLogDetails } from "../../../state/logsContent";
import { useStore } from "../../../state/store";
import { DataGrid } from "../../shared/data-grid/DataGrid";
import gridStyles from "../../shared/gridCells.module.css";
import { useKeyedMemo } from "../../shared/useKeyedMemo";
import { combineFilters } from "../listing/combineFilters";
import {
  sortingStateToOrderBy,
  useLogsListingQuery,
} from "../listing/useLogsListingQuery";
import { FileLogItem, FolderLogItem, PendingTaskItem } from "../LogItem";

import {
  useLogListColumns,
  type LogListMode,
  type ScoresViewMode,
} from "./columns/hooks";
import { LogListRow } from "./columns/types";

interface LogListGridProps {
  items: Array<FileLogItem | FolderLogItem | PendingTaskItem>;
  currentPath?: string;
  // Identifies the data scope of the current view (mode + directory). The
  // grid is keyed on this so switching scope (folder/tasks) gets a fresh
  // grid (scroll + selection reset). `undefined` means logDir is still
  // hydrating.
  scopeKey?: string;
  mode?: LogListMode;
}

type LogListItem = FileLogItem | FolderLogItem | PendingTaskItem;

// Default sort for a scope with no persisted state: most-recently-completed
// first (mirrors the samples view's `completed_at desc` default).
const kDefaultSorting: SortingState = [{ id: "completedAt", desc: true }];

const detailsForItem = (
  item: LogListItem,
  logDetails: Record<string, LogDetails>
): LogDetails | undefined =>
  item.type === "file" && item.log ? logDetails[item.log.name] : undefined;

const buildLogListRow = (
  item: LogListItem,
  details: LogDetails | undefined
): LogListRow => {
  const preview = item.type === "file" ? item.logPreview : undefined;

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
  if (details?.stats?.started_at && details?.stats?.completed_at) {
    const start = new Date(details.stats.started_at).getTime();
    const end = new Date(details.stats.completed_at).getTime();
    if (start && end && end > start) {
      duration = (end - start) / 1000;
    }
  }

  // Format task args. Prefer `task_args_passed` (the args the user
  // actually supplied at the call site) over `task_args` (which
  // would also include defaulted values).
  const taskArgsSource =
    details?.eval?.task_args_passed ?? details?.eval?.task_args;
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

  // Count of sample errors
  let sampleErrors: number | undefined;
  if (details?.sampleSummaries) {
    sampleErrors = details.sampleSummaries.filter((s) => s.error).length;
  }

  // Distinct limit types across samples in this task, comma-joined.
  // Empty when no sample ended with a limit. Sorted for stable
  // text-filtering and predictable display order.
  let sampleLimits: string | undefined;
  if (details?.sampleSummaries) {
    const limits = new Set<string>();
    for (const s of details.sampleSummaries) {
      if (s.limit) limits.add(s.limit);
    }
    if (limits.size > 0) {
      sampleLimits = Array.from(limits).sort().join(", ");
    }
  }

  const row: LogListRow = {
    id: item.id,
    name: item.name,
    displayIndex:
      item.type === "file" || item.type === "pending-task"
        ? item.displayIndex
        : undefined,
    type: item.type,
    url: item.url,
    task: item.type === "file" ? preview?.task : item.name,
    model:
      item.type === "file"
        ? preview?.model
        : item.type === "pending-task"
          ? item.model
          : undefined,
    modelRoles:
      item.type === "file" ? (preview?.model_roles ?? undefined) : undefined,
    score: preview?.primary_metric?.value,
    status: preview?.status,
    completedAt: preview?.completed_at,
    itemCount: item.type === "folder" ? item.itemCount : undefined,
    log: item.type === "file" ? item.log : undefined,
    path: item.type === "file" ? item.name : undefined,
    totalSamples: details?.results?.total_samples,
    completedSamples: details?.results?.completed_samples,
    sandbox: details?.eval?.sandbox?.type,
    totalTokens,
    duration,
    taskFile: details?.eval?.task_file ?? undefined,
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
      if (evalScore.metrics) {
        for (const [metricName, metric] of Object.entries(evalScore.metrics)) {
          row[`score_${evalScore.name}/${metricName}`] = metric.value;
        }
      }
    }
  }

  return row;
};

export const LogListGrid: FC<LogListGridProps> = ({
  items,
  currentPath,
  scopeKey,
  mode = "logs",
}) => {
  const { setFilteredCount, gridStateByScope, setGridState } = useLogsListing();

  const loading = useStore((state) => state.app.status.loading);
  const syncing = useStore((state) => state.app.status.syncing);
  const setWatchedLogs = useStore((state) => state.logsActions.setWatchedLogs);

  const logDir = useStore((state) => state.logs.logDir);
  const logDetails = useLogDetails(logDir);
  // Defer the detail map so a burst of detail flushes during initial sync
  // can't block click/scroll input — the grid renders from the prior value
  // and catches up when the main thread is idle.
  const deferredLogDetails = useDeferredValue(logDetails);
  const navigate = useNavigate();

  const logFiles = useMemo(() => {
    return items
      .filter((item) => item.type === "file")
      .map((item) => item.log)
      .filter((file) => file !== undefined);
  }, [items]);

  // Scope the column list to the current folder's logs in folder (logs) mode.
  const scopePrefix = mode === "logs" ? currentPath : undefined;
  // Read the same shared view-mode property LogsPanel writes to, so the
  // grid's column set always matches the picker's current selection.
  const [scoresViewMode] = useProperty<ScoresViewMode>(
    "log-list-scores-view",
    "mode",
    { defaultValue: "by-metric" }
  );
  const { columns, visibility, getValue, getComparator, getFilterType } =
    useLogListColumns(mode, scopePrefix, scoresViewMode);

  // Reuse the prior row object for any item whose display inputs (preview,
  // details, structural fields) are unchanged, so only changed rows pay the
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
      item.type === "file" ? item.logPreview : undefined,
      item.type === "folder" ? item.itemCount : undefined,
      item.type === "pending-task" ? item.model : undefined,
      detailsForItem(item, deferredLogDetails),
    ],
    (item) => buildLogListRow(item, detailsForItem(item, deferredLogDetails))
  );

  const handleRowActivate = useCallback(
    (row: LogListRow) => {
      if (row.url) void navigate(row.url);
    },
    [navigate]
  );

  useEffect(() => {
    setWatchedLogs(logFiles);
  }, [logFiles, setWatchedLogs]);

  // Default to Completed (descending) until the user picks a sort — matches
  // the samples view. A persisted entry (including an explicitly-cleared empty
  // sort) takes over once this scope has one.
  const sorting = useMemo<SortingState>(() => {
    const persisted = scopeKey
      ? gridStateByScope[scopeKey]?.sorting
      : undefined;
    return persisted ?? kDefaultSorting;
  }, [gridStateByScope, scopeKey]);
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

  const displayRows = useMemo(
    () => (folders.length > 0 ? [...folders, ...sortedFiles] : sortedFiles),
    [folders, sortedFiles]
  );

  const handleSortingChange = useCallback(
    (next: SortingState) => {
      if (scopeKey) setGridState(scopeKey, { sorting: next, columnFilters });
    },
    [scopeKey, setGridState, columnFilters]
  );

  const handleColumnFilterChange = useCallback(
    (
      columnId: string,
      filterType: FilterType,
      condition: SimpleCondition | null
    ) => {
      if (!scopeKey) return;
      const next: Record<string, ColumnFilter> = { ...columnFilters };
      if (condition === null) {
        delete next[columnId];
      } else {
        next[columnId] = { columnId, filterType, condition };
      }
      setGridState(scopeKey, { sorting, columnFilters: next });
    },
    [scopeKey, setGridState, sorting, columnFilters]
  );

  // Footer count = folders + matching files (reflects any active filter).
  useEffect(() => {
    setFilteredCount(folders.length + total_count);
  }, [folders.length, total_count, setFilteredCount]);

  return (
    <div className={clsx(gridStyles.gridWrapper)}>
      <div className={clsx(gridStyles.gridContainer)}>
        <DataGrid<LogListRow>
          key={scopeKey ?? "pending"}
          data={displayRows}
          columns={columns}
          columnVisibility={visibility}
          sorting={sorting}
          onSortingChange={handleSortingChange}
          columnFilters={columnFilters}
          onColumnFilterChange={handleColumnFilterChange}
          getRowId={(row) => row.id}
          onRowActivate={handleRowActivate}
          loading={data.length === 0 && (loading > 0 || syncing)}
        />
      </div>
    </div>
  );
};
