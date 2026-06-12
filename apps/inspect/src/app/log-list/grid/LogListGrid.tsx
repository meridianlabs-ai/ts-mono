import type {
  CellMouseDownEvent,
  ColDef,
  GridColumnsChangedEvent,
  GridReadyEvent,
  IRowNode,
  ModelUpdatedEvent,
  RowClickedEvent,
  StateUpdatedEvent,
} from "ag-grid-community";
import { themeBalham } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import clsx from "clsx";
import {
  FC,
  KeyboardEvent as ReactKeyboardEvent,
  RefObject,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";

import { useProperty } from "@tsmono/react/hooks";

import { LogDetails } from "../../../client/api/types";
import { FindBandUI } from "../../../components/FindBandUI";
import { useLogs, useLogsListing } from "../../../state/hooks";
import { useStore } from "../../../state/store";
import { useKeyedMemo } from "../../shared/useKeyedMemo";

import "../../shared/agGrid";

import styles from "../../shared/gridCells.module.css";
import { createGridKeyboardHandler } from "../../shared/gridKeyboardNavigation";
import { openInNewTab } from "../../shared/openInNewTab";
import gridChromeStyles from "../../shared/samples-grid/SamplesGrid.module.css";
import { useApplyColumnVisibility } from "../../shared/useApplyColumnVisibility";
import { useGridColumnRefit } from "../../shared/useGridColumnRefit";
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
  // Identifies the data scope of the current view (mode + directory).
  // Reset of filter+sort is keyed on this — same scope across renders
  // means "preserve gridState"; a change means "fresh grid". `undefined`
  // means logDir is still hydrating and we shouldn't compare yet.
  scopeKey?: string;
  gridRef?: RefObject<AgGridReact<LogListRow> | null>;
  mode?: LogListMode;
}

type LogListItem = FileLogItem | FolderLogItem | PendingTaskItem;

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
  gridRef: externalGridRef,
  mode = "logs",
}) => {
  const { gridStateByScope, setGridState, setFilteredCount } = useLogsListing();
  const gridState = scopeKey ? gridStateByScope[scopeKey] : undefined;

  const { loadAllLogOverviews } = useLogs();

  const loading = useStore((state) => state.app.status.loading);
  const syncing = useStore((state) => state.app.status.syncing);
  const setWatchedLogs = useStore((state) => state.logsActions.setWatchedLogs);

  const logDetails = useStore((state) => state.logs.logDetails);
  // Defer the detail map so a burst of detail flushes during initial sync
  // can't block click/scroll input — the grid renders from the prior value
  // and catches up when the main thread is idle.
  const deferredLogDetails = useDeferredValue(logDetails);
  const navigate = useNavigate();
  const gridRef = useRef<AgGridReact<LogListRow>>(null);
  // Bridge the grid instance to the optional external ref while keeping a
  // true local ref. A conditional `external ?? internal` expression isn't
  // recognized as a ref by the React Compiler, which would force
  // `gridRef.current` into every callback's inferred dependencies.
  const attachGridRef = useCallback(
    (instance: AgGridReact<LogListRow> | null) => {
      gridRef.current = instance;
      if (externalGridRef) externalGridRef.current = instance;
    },
    [externalGridRef]
  );
  const gridContainerRef = useRef<HTMLDivElement>(null);

  // Find functionality state - store row IDs instead of IRowNode references to avoid memory leaks
  const [showFind, setShowFind] = useState(false);
  const [findTerm, setFindTerm] = useState("");
  const [matchIds, setMatchIds] = useState<string[]>([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const findInputRef = useRef<HTMLInputElement>(null);

  // Helper to close find bar and reset state
  const closeFind = useCallback(() => {
    setShowFind(false);
    setFindTerm("");
    setMatchIds([]);
    setCurrentMatchIndex(0);
  }, []);

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
  const { columns, visibility } = useLogListColumns(
    mode,
    scopePrefix,
    scoresViewMode
  );

  // Each scope (mode + dir) has its own gridState in the store, so the
  // initial state is just the entry for the current scope. Switching to a
  // different scope hits a different key — typically `undefined` if the
  // scope hasn't been visited yet, which lets AG-Grid initialise with
  // column defaults. The `key={scopeKey}` on AgGridReact remounts the
  // grid on scope change so this initial state is actually re-applied.
  const initialGridState = gridState;

  useEffect(() => {
    gridContainerRef.current?.focus();
  }, []);

  // Reuse the prior row object for any item whose display inputs (preview,
  // details, structural fields) are unchanged. AG-Grid's immutable diff then
  // leaves those rows' DOM untouched, so a sync flush mid-click can't replace
  // the node under the pointer and swallow the click — and only changed rows
  // get the expensive per-row rebuild. Keyed on store references (which stay
  // stable across flushes for unchanged logs) rather than the `item` object,
  // so it works even though `items` is rebuilt each flush upstream.
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

  const handleRowClick = useCallback(
    (e: RowClickedEvent<LogListRow>) => {
      if (e.data && e.node && gridRef.current?.api) {
        gridRef.current.api.deselectAll();
        e.node.setSelected(true);

        const mouseEvent = e.event as MouseEvent | undefined;
        // Modifier clicks are handled by the <a> overlay in the cell renderer
        if (
          mouseEvent?.metaKey ||
          mouseEvent?.ctrlKey ||
          mouseEvent?.shiftKey ||
          mouseEvent?.button === 1
        ) {
          return;
        }

        const url = e.data.url;
        if (url) {
          setTimeout(() => {
            navigate(url);
          }, 10);
        }
      }
    },
    [navigate]
  );

  const handleOpenRow = useCallback(
    (rowNode: IRowNode<LogListRow>, e: KeyboardEvent) => {
      if (!rowNode.data?.url) {
        return;
      }
      const openInNewWindow = e.metaKey || e.ctrlKey || e.shiftKey;
      if (openInNewWindow) {
        openInNewTab(rowNode.data.url);
      } else {
        navigate(rowNode.data.url);
      }
    },
    [navigate]
  );

  // The handler is created inside the effect because it closes over the
  // grid ref, which render-phase code must not touch.
  useEffect(() => {
    const gridElement = gridContainerRef.current;
    if (!gridElement) return;

    const handleKeyDown = createGridKeyboardHandler<LogListRow>({
      gridRef,
      onOpenRow: handleOpenRow,
    });
    gridElement.addEventListener("keydown", handleKeyDown);

    return () => {
      gridElement.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleOpenRow]);

  const handleCellMouseDown = useCallback(
    (_e: CellMouseDownEvent<LogListRow>) => {
      // Middle-click and modifier clicks are handled by the <a> overlay
      // in the cell renderer for native background-tab behavior
    },
    []
  );

  useEffect(() => {
    setWatchedLogs(logFiles);
  }, [logFiles, setWatchedLogs]);

  const applyVisibility = useApplyColumnVisibility(
    gridRef,
    columns,
    visibility
  );

  // Dev-only test hook: expose AG-Grid api so Playwright tests can drive
  // filter/sort programmatically. Vite strips this branch in production.
  const handleGridReady = useCallback(
    (e: GridReadyEvent<LogListRow>) => {
      if (import.meta.env.DEV) {
        (window as unknown as { __inspectGridApi?: unknown }).__inspectGridApi =
          e.api;
      }
      // The visibility effect above ran before the api was ready; apply
      // now that it is.
      applyVisibility();
    },
    [applyVisibility]
  );

  const handleSortChanged = useCallback(async () => {
    await loadAllLogOverviews();
    setWatchedLogs(logFiles);
  }, [loadAllLogOverviews, setWatchedLogs, logFiles]);

  const handleFilterChanged = useCallback(async () => {
    await loadAllLogOverviews();
    setWatchedLogs(logFiles);
  }, [loadAllLogOverviews, setWatchedLogs, logFiles]);

  const handleModelUpdated = useCallback(
    (e: ModelUpdatedEvent<LogListRow>) => {
      setFilteredCount(e.api.getDisplayedRowCount());
    },
    [setFilteredCount]
  );

  const maxColCount = useRef(0);

  // Auto-fit defers to the user: once they manually resize a column, all
  // subsequent auto-fits below are suppressed so their widths stick.
  const { refitColumns, handleColumnResized } = useGridColumnRefit(gridRef);

  // Refit when the column set changes (e.g. the scores view-mode toggle
  // swaps the score column set). `columns` is content-stable across
  // logDetails flushes (see useLogListColumns), so this no longer fires —
  // and wipes user-dragged widths — on every detail flush while loading.
  useEffect(() => {
    refitColumns();
  }, [columns, refitColumns]);

  const handleGridColumnsChanged = useCallback(
    (e: GridColumnsChangedEvent<LogListRow>) => {
      const cols = e.api.getColumnDefs();
      if (cols && cols.length > maxColCount.current) {
        maxColCount.current = cols.length;
        refitColumns();
      }
    },
    [refitColumns]
  );

  // Find functionality - searches across the currently visible columns.
  // Formatted cell values are cached per (data, columns) so only keystrokes
  // after a data/visibility change pay the formatter cost.
  const searchCacheRef = useRef<{
    data: LogListRow[] | null;
    columns: ColDef<LogListRow>[] | null;
    cache: Map<string, string>;
  }>({ data: null, columns: null, cache: new Map() });

  const performSearch = useCallback(
    (term: string) => {
      const api = gridRef.current?.api;
      if (!api || !term) {
        setMatchIds([]);
        setCurrentMatchIndex(0);
        return;
      }

      // Rebuild cache if data or visible columns changed since last search
      const cached = searchCacheRef.current;
      let cache = cached.cache;
      if (cached.data !== data || cached.columns !== columns) {
        cache = new Map();
        const displayedColumns = api.getAllDisplayedColumns();
        api.forEachNode((node) => {
          if (!node.data) return;
          const parts: string[] = [];
          for (const col of displayedColumns) {
            const value = api.getCellValue({
              rowNode: node,
              colKey: col,
              useFormatter: true,
            });
            if (value) parts.push(String(value));
          }
          cache.set(node.data.id, parts.join(" ").toLowerCase());
        });
        searchCacheRef.current = { data, columns, cache };
      }

      const lowerTerm = term.toLowerCase();
      const foundIds: string[] = [];
      api.forEachNode((node) => {
        if (!node.data) return;
        const text = cache.get(node.data.id);
        if (text && text.includes(lowerTerm)) {
          foundIds.push(node.data.id);
        }
      });
      setMatchIds(foundIds);
      setCurrentMatchIndex(0);
      if (foundIds.length > 0) {
        const firstNode = api.getRowNode(foundIds[0]);
        if (firstNode) {
          api.deselectAll();
          api.ensureNodeVisible(firstNode, "middle");
          firstNode.setSelected(true, true);
        }
      }
    },
    [data, columns]
  );

  const goToMatch = useCallback(
    (index: number) => {
      if (matchIds.length === 0) return;
      const idx =
        ((index % matchIds.length) + matchIds.length) % matchIds.length;
      setCurrentMatchIndex(idx);
      const api = gridRef.current?.api;
      if (!api) return;
      const node = api.getRowNode(matchIds[idx]);
      if (node) {
        api.deselectAll();
        api.ensureNodeVisible(node, "middle");
        node.setSelected(true, true);
      }
    },
    [matchIds]
  );

  const handleInputKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        closeFind();
      } else if (e.key === "Enter") {
        e.preventDefault();
        goToMatch(currentMatchIndex + (e.shiftKey ? -1 : 1));
      }
    },
    [goToMatch, currentMatchIndex, closeFind]
  );

  useEffect(() => {
    const handleFindKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        e.stopPropagation();
        setShowFind(true);
        setTimeout(() => findInputRef.current?.focus(), 100);
      }
      if (e.key === "Escape" && showFind) {
        closeFind();
      }
    };
    document.addEventListener("keydown", handleFindKeyDown, true);
    return () =>
      document.removeEventListener("keydown", handleFindKeyDown, true);
  }, [closeFind, showFind]);

  // performSearch handles the empty term by clearing match state, so a
  // single call covers both the search and reset paths.
  useEffect(() => {
    performSearch(findTerm);
  }, [findTerm, performSearch]);

  return (
    <div className={clsx(styles.gridWrapper)}>
      {showFind && (
        <FindBandUI
          inputRef={findInputRef}
          value={findTerm}
          onChange={() => setFindTerm(findInputRef.current?.value ?? "")}
          onKeyDown={handleInputKeyDown}
          onClose={closeFind}
          onPrevious={() => goToMatch(currentMatchIndex - 1)}
          onNext={() => goToMatch(currentMatchIndex + 1)}
          disableNav={matchIds.length === 0}
          noResults={!!findTerm && matchIds.length === 0}
          matchCount={findTerm ? matchIds.length : undefined}
          matchIndex={findTerm ? currentMatchIndex : undefined}
        />
      )}
      <div
        ref={gridContainerRef}
        className={clsx(styles.gridContainer, gridChromeStyles.gridChrome)}
        tabIndex={0}
      >
        <AgGridReact<LogListRow>
          // Remount on scope change so filter/sort/column state get a clean
          // slate. AG-Grid's `initialState` is one-shot at mount, so a key
          // change is the cleanest way to reset everything declaratively.
          key={scopeKey ?? "pending"}
          ref={attachGridRef}
          rowData={data}
          animateRows={false}
          suppressColumnMoveAnimation={true}
          columnDefs={columns}
          maintainColumnOrder={true}
          defaultColDef={{
            sortable: true,
            filter: true,
            resizable: true,
          }}
          tooltipShowDelay={2000}
          tooltipInteraction={true}
          popupParent={document.body}
          autoSizeStrategy={{ type: "fitGridWidth" }}
          headerHeight={25}
          rowSelection={{ mode: "singleRow", checkboxes: false }}
          getRowId={(params) => params.data.id}
          onGridColumnsChanged={handleGridColumnsChanged}
          onGridSizeChanged={refitColumns}
          onColumnResized={handleColumnResized}
          theme={themeBalham}
          enableCellTextSelection={true}
          initialState={initialGridState}
          suppressCellFocus={true}
          onStateUpdated={(e: StateUpdatedEvent<LogListRow>) => {
            // Don't write under an unhydrated scope — we'd lose track of
            // which scope this state belongs to.
            if (scopeKey !== undefined) {
              setGridState(scopeKey, e.state);
            }
          }}
          onGridReady={handleGridReady}
          onRowClicked={handleRowClick}
          onCellMouseDown={handleCellMouseDown}
          onSortChanged={handleSortChanged}
          onFilterChanged={handleFilterChanged}
          onModelUpdated={handleModelUpdated}
          loading={data.length === 0 && (loading > 0 || syncing)}
        />
      </div>
    </div>
  );
};
