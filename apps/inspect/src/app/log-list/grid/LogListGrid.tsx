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
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";

import { useProperty } from "@tsmono/react/hooks";

import { FindBandUI } from "../../../components/FindBandUI";
import { useLogs, useLogsListing } from "../../../state/hooks";
import { useStore } from "../../../state/store";

import "../../shared/agGrid";

import styles from "../../shared/gridCells.module.css";
import { createGridKeyboardHandler } from "../../shared/gridKeyboardNavigation";
import { createGridColumnResizer, getFieldKey } from "../../shared/gridUtils";
import gridChromeStyles from "../../shared/samples-grid/SamplesGrid.module.css";
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

export const LogListGrid: FC<LogListGridProps> = ({
  items,
  currentPath,
  scopeKey,
  gridRef: externalGridRef,
  mode = "logs",
}) => {
  const { gridStateByScope, setGridState, setFilteredCount } = useLogsListing();
  const gridState = scopeKey ? gridStateByScope[scopeKey] : undefined;

  const { loadLogOverviews, loadAllLogOverviews } = useLogs();

  const loading = useStore((state) => state.app.status.loading);
  const syncing = useStore((state) => state.app.status.syncing);
  const setWatchedLogs = useStore((state) => state.logsActions.setWatchedLogs);

  const logPreviews = useStore((state) => state.logs.logPreviews);
  const logDetails = useStore((state) => state.logs.logDetails);
  const navigate = useNavigate();
  const internalGridRef = useRef<AgGridReact<LogListRow>>(null);
  const gridRef = externalGridRef ?? internalGridRef;
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

  const data: LogListRow[] = useMemo(() => {
    return items.map((item) => {
      const preview = item.type === "file" ? item.logPreview : undefined;
      const details =
        item.type === "file" && item.log
          ? logDetails[item.log.name]
          : undefined;

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

      // Format task args
      let taskArgs: string | undefined;
      if (details?.eval?.task_args) {
        const entries = Object.entries(details.eval.task_args);
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
          item.type === "file"
            ? (preview?.model_roles ?? undefined)
            : undefined,
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
        taskArgsRaw: details?.eval?.task_args ?? undefined,
        tags: details?.tags,
        percentCompleted,
        sampleErrors,
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
            for (const [metricName, metric] of Object.entries(
              evalScore.metrics
            )) {
              row[`score_${evalScore.name}/${metricName}`] = metric.value;
            }
          }
        }
      }

      return row;
    });
  }, [items, logDetails]);

  const handleRowClick = useCallback(
    (e: RowClickedEvent<LogListRow>) => {
      if (e.data && e.node && gridRef.current?.api) {
        gridRef.current.api.deselectAll();
        e.node.setSelected(true);

        const mouseEvent = e.event as MouseEvent | undefined;
        const openInNewWindow =
          mouseEvent?.metaKey ||
          mouseEvent?.ctrlKey ||
          mouseEvent?.shiftKey ||
          mouseEvent?.button === 1;

        const url = e.data.url;
        if (url) {
          setTimeout(() => {
            if (openInNewWindow) {
              window.open(`#${url}`, "_blank");
            } else {
              navigate(url);
            }
          }, 10);
        }
      }
    },
    [navigate, gridRef]
  );

  const handleOpenRow = useCallback(
    (rowNode: IRowNode<LogListRow>, e: KeyboardEvent) => {
      if (!rowNode.data?.url) {
        return;
      }
      const openInNewWindow = e.metaKey || e.ctrlKey || e.shiftKey;
      if (openInNewWindow) {
        window.open(`#${rowNode.data.url}`, "_blank");
      } else {
        navigate(rowNode.data.url);
      }
    },
    [navigate]
  );

  const handleKeyDown = useMemo(
    () =>
      createGridKeyboardHandler<LogListRow>({
        gridRef,
        onOpenRow: handleOpenRow,
      }),
    [gridRef, handleOpenRow]
  );

  useEffect(() => {
    const gridElement = gridContainerRef.current;
    if (!gridElement) return;

    gridElement.addEventListener("keydown", handleKeyDown);

    return () => {
      gridElement.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleKeyDown]);

  const handleCellMouseDown = useCallback(
    (e: CellMouseDownEvent<LogListRow>) => {
      const mouseEvent = e.event as MouseEvent | undefined;
      if (mouseEvent?.button === 1 && e.data?.url) {
        mouseEvent.preventDefault();
        window.open(`#${e.data.url}`, "_blank");
      }
    },
    []
  );

  useEffect(() => {
    const loadHeaders = async () => {
      const filesToLoad = logFiles.filter((file) => !logPreviews[file.name]);
      if (filesToLoad.length > 0) {
        await loadLogOverviews(filesToLoad);
      }
      setWatchedLogs(logFiles);
    };
    loadHeaders();
  }, [logFiles, loadLogOverviews, setWatchedLogs, logPreviews]);

  // Apply visibility via the ag-grid api so the column-def reference
  // stays stable across visibility toggles. Re-passing columnDefs with
  // `hide:` injected would reset user-driven width and reorder state.
  //
  // Wrapped in a callback so we can fire it both from the useEffect (when
  // visibility changes) and from `onGridReady` (the first effect call
  // happens before the api exists, so without that second hook a fresh
  // mount would render with default visibility regardless of what the
  // user previously hid).
  const applyVisibility = useCallback(() => {
    const api = gridRef.current?.api;
    if (!api) return;
    const state = columns.map((c) => ({
      colId: getFieldKey(c),
      hide: visibility[getFieldKey(c)] === false,
    }));
    if (state.length > 0) api.applyColumnState({ state });
  }, [visibility, columns, gridRef]);
  useEffect(() => {
    applyVisibility();
  }, [applyVisibility]);

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

  const resizeGridColumns = useRef(createGridColumnResizer(gridRef)).current;

  // Resize grid columns when columns prop changes (e.g., when columns are hidden/unhidden)
  useEffect(() => {
    resizeGridColumns();
  }, [columns, resizeGridColumns]);

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
    [data, columns, gridRef]
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
    [matchIds, gridRef]
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

  useEffect(() => {
    if (findTerm) {
      performSearch(findTerm);
    } else {
      setMatchIds([]);
      setCurrentMatchIndex(0);
    }
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
          ref={gridRef}
          rowData={data}
          animateRows={false}
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
          onGridColumnsChanged={(e: GridColumnsChangedEvent<LogListRow>) => {
            const cols = e.api.getColumnDefs();
            if (cols && cols?.length > maxColCount.current) {
              maxColCount.current = cols.length;
              resizeGridColumns();
            }
          }}
          onGridSizeChanged={resizeGridColumns}
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
