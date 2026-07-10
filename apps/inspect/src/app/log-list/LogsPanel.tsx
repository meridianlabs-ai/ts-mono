import clsx from "clsx";
import { FC, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { EvalSet } from "@tsmono/inspect-common/types";
import { ErrorPanel, ProgressBar } from "@tsmono/react/components";
import { useProperty } from "@tsmono/react/hooks";
import { dirname, isInDirectory } from "@tsmono/util";

import { useLogDir } from "../../app_config";
import { useLogListing, useLogsSync, type LogListingRow } from "../../log_data";
import { setDocumentTitle } from "../../state/actions";
import { useLogsListing } from "../../state/hooks";
import { useStore } from "../../state/store";
import { useUserSettings } from "../../state/userSettings";
import { directoryRelativeUrl, join } from "../../utils/uri";
import { ApplicationIcons } from "../appearance/icons";
import { FlowButton } from "../flow/FlowButton";
import { useFlowQuery } from "../flow/hooks";
import { ApplicationNavbar } from "../navbar/ApplicationNavbar";
import { NavbarButton } from "../navbar/NavbarButton";
import { ViewSegmentedControl } from "../navbar/ViewSegmentedControl";
import { logsUrl, tasksUrl, useLogRouteParams } from "../routing/url";
import { useEvalSet } from "../server/useEvalSet";
import { ColumnSelectorPopover } from "../shared/ColumnSelectorPopover";

import { useLogListColumns, type ScoresViewMode } from "./grid/columns/hooks";
import { LogListGrid } from "./grid/LogListGrid";
import { useLogListData } from "./grid/useLogListData";
import { FileLogItem, FolderLogItem, PendingTaskItem } from "./LogItem";
import { LogListFooter } from "./LogListFooter";
import styles from "./LogsPanel.module.css";

const rootName = (relativePath: string) => {
  return relativePath.split("/")[0] ?? "";
};

const kNoListingRows: LogListingRow[] = [];

export type LogsPanelMode = "logs" | "tasks";

interface LogsPanelProps {
  maybeShowSingleLog?: boolean;
  mode?: LogsPanelMode;
}

export const LogsPanel: FC<LogsPanelProps> = ({
  maybeShowSingleLog,
  mode = "logs",
}) => {
  const [showColumnSelector, setShowColumnSelector] = useState(false);
  const [columnButtonEl, setColumnButtonEl] =
    useState<HTMLButtonElement | null>(null);

  const showRetriedLogs = useUserSettings((state) => state.showRetriedLogs);
  const setShowRetriedLogs = useUserSettings(
    (state) => state.setShowRetriedLogs
  );
  const logDir = useLogDir();
  const listing = useLogListing(logDir);
  const logFiles = listing.data ?? kNoListingRows;
  const { gridStateByScope, patchGridState } = useLogsListing();

  const navigate = useNavigate();

  const { logPath } = useLogRouteParams();
  const evalSet = useEvalSet(logPath || "").data;
  // Sync the listing for this panel's scope; the error panel and busy
  // indications derive from its status folded with the listing read's own
  // loading/error.
  const sync = useLogsSync(logDir, logPath ?? "");
  const busy = sync.busy || listing.loading;
  // The navbar bar tracks the sync round-trip only — engine background
  // fetching (`busy`) stays in the footer/overlay indications.
  const navbarLoading = sync.loading || listing.loading;
  const error = sync.error ?? listing.error;

  const currentDir = join(logPath || "", logDir);

  // Identifies the current data scope for the log list. Each scope keeps
  // its own filter/sort independently in the store: Tasks at the root and
  // Folders at the root are distinct scopes, so toggling between them
  // restores each side's state instead of clearing. Folder drill-down is
  // a different scope (different dir), so each folder also remembers its
  // own state.
  const scopeKey = `${mode}::${currentDir}`;

  const flowData = useFlowQuery(logPath || "").data;

  useEffect(() => {
    setDocumentTitle({
      logDir: logDir,
    });
  }, [logDir]);

  const [logItems, hasRetriedLogs]: [
    Array<FileLogItem | FolderLogItem | PendingTaskItem>,
    boolean,
  ] = useMemo(() => {
    if (mode === "tasks") {
      // Flat mode: show all log files without folder grouping
      const fileItems: Array<FileLogItem | PendingTaskItem> = [];
      const existingLogTaskIds = new Set<string>();
      let _hasRetriedLogs = false;

      for (const logFile of logFiles) {
        if (logFile.task_id) {
          existingLogTaskIds.add(logFile.task_id);
        }

        if (logFile.retried) {
          _hasRetriedLogs = true;
        }

        if (showRetriedLogs || !logFile.retried) {
          const relativePath = directoryRelativeUrl(logFile.name, logDir);
          const decodedPath = decodeURIComponent(relativePath);

          fileItems.push({
            id: logFile.name,
            name: decodedPath,
            type: "file",
            url: tasksUrl(decodedPath, logDir),
            log: logFile,
          });
        }
      }

      const allItems = appendPendingItems(
        evalSet,
        existingLogTaskIds,
        fileItems
      );
      return [allItems, _hasRetriedLogs];
    }

    // Folder-grouped mode (default)
    const folderItems: Array<FileLogItem | FolderLogItem | PendingTaskItem> =
      [];
    const fileItems: Array<FileLogItem | FolderLogItem | PendingTaskItem> = [];

    // Track processed folders to avoid duplicates
    const processedFolders = new Set<string>();
    const existingLogTaskIds = new Set<string>();
    let _hasRetriedLogs = false;

    // Count logs under a path prefix via binary search rather than a full
    // scan per folder (which made folder counting O(folders × logs)). Names
    // sort into contiguous ranges, so a prefix count is two bound lookups.
    const sortedNames = logFiles.map((f) => f.name).sort();
    const lowerBound = (target: string): number => {
      let lo = 0;
      let hi = sortedNames.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        const name = sortedNames[mid];
        if (name !== undefined && name < target) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    };
    const countWithPrefix = (prefix: string): number =>
      lowerBound(prefix + "\uffff") - lowerBound(prefix);

    for (const logFile of logFiles) {
      if (logFile.task_id) {
        existingLogTaskIds.add(logFile.task_id);
      }

      const name = logFile.name;

      const cleanDir = currentDir.endsWith("/")
        ? currentDir.slice(0, -1)
        : currentDir;

      const dirWithSlash = !currentDir.endsWith("/")
        ? currentDir + "/"
        : currentDir;

      if (isInDirectory(name, cleanDir)) {
        const dirName = directoryRelativeUrl(currentDir, logDir);
        const relativePath = directoryRelativeUrl(name, currentDir);

        const fileOrFolderName = decodeURIComponent(rootName(relativePath));
        const path = join(
          decodeURIComponent(relativePath),
          decodeURIComponent(dirName)
        );

        if (logFile.retried) {
          _hasRetriedLogs = true;
        }

        if (showRetriedLogs || !logFile.retried) {
          fileItems.push({
            id: fileOrFolderName,
            name: fileOrFolderName,
            type: "file",
            url: logsUrl(path, logDir),
            log: logFile,
          });
        }
      } else if (name.startsWith(dirWithSlash)) {
        // This is file that is next level (or deeper) child of the current directory
        const relativePath = directoryRelativeUrl(name, currentDir);

        const dirName = decodeURIComponent(rootName(relativePath));
        const currentDirRelative = directoryRelativeUrl(currentDir, logDir);
        const url = join(dirName, decodeURIComponent(currentDirRelative));
        if (!processedFolders.has(dirName)) {
          folderItems.push({
            id: dirName,
            name: dirName,
            type: "folder",
            url: logsUrl(url, logDir),
            itemCount: countWithPrefix(dirname(name)),
          });
          processedFolders.add(dirName);
        }
      }
    }

    const orderedItems = [...folderItems, ...fileItems];

    const _logFiles = appendPendingItems(
      evalSet,
      existingLogTaskIds,
      orderedItems
    );

    return [_logFiles, _hasRetriedLogs];
  }, [mode, evalSet, logFiles, currentDir, logDir, showRetriedLogs]);

  // In the folder view, scope the Metrics list to logs under the current
  // directory so descending into a subfolder shows only that folder's metrics.
  // The flat tasks view shows columns across the whole set.
  const scopePrefix = mode === "logs" ? currentDir : undefined;

  // Shared view-mode state for the scorer columns. The same useProperty
  // scope/key is read by LogListGrid so the grid and popover stay in sync,
  // and by persisting via useProperty the choice survives reloads.
  const [scoresViewMode, setScoresViewMode] = useProperty<ScoresViewMode>(
    "log-list-scores-view",
    "mode",
    { defaultValue: "by-metric" }
  );

  // LogsPanel uses `pickerColumns` for the popover so it only shows the
  // active view mode's checkboxes; the grid (LogListGrid) reads `columns`
  // from its own `useLogListColumns` call and gets both sets for stability.
  const {
    pickerColumns,
    visibility,
    setColumnVisibility,
    getValue,
    getComparator,
    getFilterType,
  } = useLogListColumns(mode, scopePrefix, scoresViewMode);

  const listData = useLogListData({
    items: logItems,
    scopeKey,
    getValue,
    getComparator,
    getFilterType,
  });

  const currentColumnVisibility = useStore(
    (state) => state.logs.listing.columnVisibility
  );

  // Active per-column filters for this scope (drives the Reset button + the
  // Columns popover's filter markers).
  const filteredFields = useMemo(
    () => Object.keys(listData.columnFilters ?? {}),
    [listData.columnFilters]
  );
  const hasFilter = filteredFields.length > 0;

  const handleResetFilters = useCallback(() => {
    if (scopeKey) patchGridState(scopeKey, { columnFilters: {} });
  }, [scopeKey, patchGridState]);

  // The popover only sees `pickerColumns` (the active view mode), so the
  // visibility map it emits is scoped to those fields. Merge it into the full
  // stored map. Hiding a column also clears any active filter on it (matches
  // the prior grid — a hidden column shouldn't keep filtering invisibly).
  const handleColumnVisibilityChange = useCallback(
    (newVisibility: Record<string, boolean>) => {
      const merged = { ...currentColumnVisibility, ...newVisibility };
      if (scopeKey) {
        const cf = gridStateByScope[scopeKey]?.columnFilters;
        if (cf) {
          const next = { ...cf };
          let changed = false;
          for (const id of Object.keys(cf)) {
            if (merged[id] === false) {
              delete next[id];
              changed = true;
            }
          }
          if (changed) patchGridState(scopeKey, { columnFilters: next });
        }
      }
      setColumnVisibility(merged);
    },
    [
      currentColumnVisibility,
      setColumnVisibility,
      scopeKey,
      gridStateByScope,
      patchGridState,
    ]
  );

  const progress = useMemo(() => {
    let pending = 0;
    let total = 0;
    for (const item of logItems) {
      if (item.type === "file" || item.type === "pending-task") {
        total += 1;
        if (item.type === "pending-task" || item.log.status === "started") {
          pending += 1;
        }
      }
    }
    return {
      complete: total - pending,
      total,
    };
  }, [logItems]);

  useEffect(() => {
    const onlyItem = logItems.length === 1 ? logItems[0] : undefined;
    if (maybeShowSingleLog && onlyItem?.url) {
      void navigate(onlyItem.url);
    }
  }, [logItems, maybeShowSingleLog, navigate]);

  return (
    <div className={clsx(styles.panel)}>
      <ApplicationNavbar
        fnNavigationUrl={mode === "tasks" ? tasksUrl : logsUrl}
        currentPath={mode === "tasks" ? undefined : logPath}
        loading={navbarLoading}
      >
        {hasFilter && (
          <NavbarButton
            key="reset-filters"
            label="Reset Filters"
            icon={ApplicationIcons.filter}
            onClick={handleResetFilters}
          />
        )}

        {hasRetriedLogs && (
          <NavbarButton
            key="show-retried"
            label="Show Retried Logs"
            icon={
              showRetriedLogs
                ? ApplicationIcons.toggle.on
                : ApplicationIcons.toggle.off
            }
            latched={showRetriedLogs}
            subtle
            onClick={() => setShowRetriedLogs(!showRetriedLogs)}
          />
        )}

        <NavbarButton
          key="choose-columns"
          ref={setColumnButtonEl}
          label="Columns"
          icon={ApplicationIcons.columns}
          dropdown
          subtle
          onClick={(e) => {
            e.stopPropagation();
            setShowColumnSelector((prev) => !prev);
          }}
        />

        <ViewSegmentedControl
          selectedSegment={mode === "tasks" ? "tasks" : "logs"}
        />
        {flowData && <FlowButton />}
      </ApplicationNavbar>

      <ColumnSelectorPopover
        showing={showColumnSelector}
        setShowing={setShowColumnSelector}
        columns={pickerColumns}
        visibility={visibility}
        onVisibilityChange={handleColumnVisibilityChange}
        positionEl={columnButtonEl}
        filteredFields={filteredFields}
        scoresHeading="Metrics"
        groupableScores
        scoresViewMode={scoresViewMode}
        onScoresViewModeChange={setScoresViewMode}
      />

      {error ? (
        <ErrorPanel
          title="Error"
          error={{ message: error.message, stack: error.stack }}
        />
      ) : (
        <>
          <div className={clsx(styles.list, "text-size-smaller")}>
            <LogListGrid
              rows={listData.rows}
              totalRowCount={listData.totalRowCount}
              sorting={listData.sorting}
              columnFilters={listData.columnFilters}
              currentPath={currentDir}
              scopeKey={scopeKey}
              mode={mode}
              busy={busy}
            />
          </div>
          <LogListFooter
            itemCount={logItems.length}
            filteredCount={listData.filteredCount}
            progressText={busy ? "Syncing data" : undefined}
            progressBar={
              progress.total !== progress.complete ? (
                <ProgressBar
                  min={0}
                  max={progress.total}
                  value={progress.complete}
                  width="100px"
                />
              ) : undefined
            }
          />
        </>
      )}
    </div>
  );
};

const appendPendingItems = (
  evalSet: EvalSet | undefined,
  tasksWithLogFiles: Set<string>,
  collapsedLogItems: (FileLogItem | FolderLogItem | PendingTaskItem)[]
): (FileLogItem | FolderLogItem | PendingTaskItem)[] => {
  const pendingTasks = new Array<PendingTaskItem>();
  for (const task of evalSet?.tasks || []) {
    if (!tasksWithLogFiles.has(task.task_id)) {
      pendingTasks.push({
        id: task.task_id,
        name: task.name || "<unknown>",
        model: task.model,
        type: "pending-task",
      });
    }
  }

  // Sort pending tasks by name
  pendingTasks.sort((a, b) => a.name.localeCompare(b.name));

  collapsedLogItems.push(...pendingTasks);

  return collapsedLogItems;
};
