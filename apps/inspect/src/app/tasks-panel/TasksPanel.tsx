import { AgGridReact } from "ag-grid-react";
import clsx from "clsx";
import { FC, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { EvalSet } from "@tsmono/inspect-common/types";
import { ProgressBar } from "@tsmono/react/components";

import {
  useLogs,
  useLogsWithretried,
} from "../../state/hooks";
import { useStore } from "../../state/store";
import { directoryRelativeUrl } from "../../utils/uri";
import { ApplicationIcons } from "../appearance/icons";
import { FlowButton } from "../flow/FlowButton";
import { useFlowServerData } from "../flow/hooks";
import { useLogListColumns } from "../log-list/grid/columns/hooks";
import { LogListRow } from "../log-list/grid/columns/types";
import { LogListGrid } from "../log-list/grid/LogListGrid";
import { FileLogItem, FolderLogItem, PendingTaskItem } from "../log-list/LogItem";
import { LogListFooter } from "../log-list/LogListFooter";
import { ApplicationNavbar } from "../navbar/ApplicationNavbar";
import { NavbarButton } from "../navbar/NavbarButton";
import { ViewSegmentedControl } from "../navbar/ViewSegmentedControl";
import { logsUrl, tasksUrl } from "../routing/url";
import { ColumnSelectorPopover } from "../shared/ColumnSelectorPopover";

import styles from "./TasksPanel.module.css";

export const TasksPanel: FC = () => {
  const { loadLogs } = useLogs();
  const gridRef = useRef<AgGridReact<LogListRow>>(null);
  const [showColumnSelector, setShowColumnSelector] = useState(false);
  const columnButtonRef = useRef<HTMLButtonElement>(null);

  const showRetriedLogs = useStore((state) => state.logs.showRetriedLogs);
  const setShowRetriedLogs = useStore(
    (state) => state.logsActions.setShowRetriedLogs
  );
  const logDir = useStore((state) => state.logs.logDir);
  const logFiles = useLogsWithretried();
  const evalSet = useStore((state) => state.logs.evalSet);
  const logPreviews = useStore((state) => state.logs.logPreviews);

  const syncing = useStore((state) => state.app.status.syncing);

  useFlowServerData("");
  const flowData = useStore((state) => state.logs.flow);

  // Build a flat list of all log files (no folder grouping)
  const [logItems, hasRetriedLogs]: [
    Array<FileLogItem | FolderLogItem | PendingTaskItem>,
    boolean,
  ] = useMemo(() => {
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
          url: logsUrl(decodedPath, logDir),
          log: logFile,
          logPreview: logPreviews[logFile.name],
        });
      }
    }

    const allItems = appendPendingItems(evalSet, existingLogTaskIds, fileItems);
    return [allItems, _hasRetriedLogs];
  }, [evalSet, logFiles, logDir, logPreviews, showRetriedLogs]);

  const { columns, setColumnVisibility } = useLogListColumns();

  const handleColumnVisibilityChange = useCallback(
    (newVisibility: Record<string, boolean>) => {
      if (gridRef.current?.api) {
        const currentFilterModel = gridRef.current.api.getFilterModel() || {};
        let filtersRemoved = false;
        const newFilterModel: Record<string, unknown> = {};

        for (const [field, filter] of Object.entries(currentFilterModel)) {
          if (newVisibility[field] === false) {
            filtersRemoved = true;
          } else {
            newFilterModel[field] = filter;
          }
        }

        if (filtersRemoved) {
          gridRef.current.api.setFilterModel(newFilterModel);
        }
      }

      setColumnVisibility(newVisibility);
    },
    [setColumnVisibility]
  );

  const progress = useMemo(() => {
    let pending = 0;
    let total = 0;
    for (const item of logItems) {
      if (item.type === "file" || item.type === "pending-task") {
        total += 1;
        if (
          item.type === "pending-task" ||
          item.logPreview?.status === "started"
        ) {
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
    loadLogs(undefined);
  }, [loadLogs]);

  const handleResetFilters = () => {
    if (gridRef.current?.api) {
      gridRef.current.api.setFilterModel(null);
    }
  };

  const filterModel = gridRef.current?.api?.getFilterModel() || {};
  const filteredFields = Object.keys(filterModel);
  const hasFilter = filteredFields.length > 0;

  return (
    <div className={clsx(styles.panel)}>
      <ApplicationNavbar
        fnNavigationUrl={tasksUrl}
        currentPath={undefined}
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
            onClick={() => setShowRetriedLogs(!showRetriedLogs)}
          />
        )}

        <NavbarButton
          key="choose-columns"
          ref={columnButtonRef}
          label="Choose Columns"
          icon={ApplicationIcons.checkbox.checked}
          onClick={(e) => {
            e.stopPropagation();
            setShowColumnSelector((prev) => !prev);
          }}
        />

        <ViewSegmentedControl selectedSegment="tasks" />
        {flowData && <FlowButton />}
      </ApplicationNavbar>

      <ColumnSelectorPopover
        showing={showColumnSelector}
        setShowing={setShowColumnSelector}
        columns={columns}
        onVisibilityChange={handleColumnVisibilityChange}
        positionEl={columnButtonRef.current}
        filteredFields={filteredFields}
      />

      <>
        <div className={clsx(styles.list, "text-size-smaller")}>
          <LogListGrid
            items={logItems}
            gridRef={gridRef}
          />
        </div>
        <LogListFooter
          itemCount={logItems.length}
          progressText={syncing ? "Syncing data" : undefined}
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
    </div>
  );
};

const appendPendingItems = (
  evalSet: EvalSet | undefined,
  tasksWithLogFiles: Set<string>,
  items: (FileLogItem | FolderLogItem | PendingTaskItem)[]
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

  pendingTasks.sort((a, b) => a.name.localeCompare(b.name));
  items.push(...pendingTasks);

  return items;
};
