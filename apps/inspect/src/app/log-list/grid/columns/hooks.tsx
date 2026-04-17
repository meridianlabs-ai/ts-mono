import type { ColDef, ICellRendererParams } from "ag-grid-community";
import clsx from "clsx";
import { useEffect, useMemo } from "react";

import { basename, formatNumber, formatPrettyDecimal } from "@tsmono/util";

import { useStore } from "../../../../state/store";
import { parseLogFileName } from "../../../../utils/evallog";
import { formatDateTime, formatTime } from "../../../../utils/format";
import { ApplicationIcons } from "../../../appearance/icons";
import sharedStyles from "../../../shared/gridCells.module.css";
import {
  comparators,
  createFolderFirstComparator,
} from "../../../shared/gridComparators";
import { getFieldKey } from "../../../shared/gridUtils";
import { PreformattedTooltip } from "../PreformattedTooltip";

import localStyles from "./columns.module.css";
import { LogListRow } from "./types";

const styles = { ...sharedStyles, ...localStyles };

const EmptyCell = () => <div>-</div>;

export type LogListMode = "logs" | "tasks";

export const useLogListColumns = (
  mode: LogListMode = "logs"
): {
  columns: ColDef<LogListRow>[];
  setColumnVisibility: (visibility: Record<string, boolean>) => void;
} => {
  const columnVisibility = useStore(
    (state) => state.logs.listing.columnVisibility
  );
  const setColumnVisibility = useStore(
    (state) => state.logsActions.setLogsColumnVisibility
  );
  const logDetails = useStore((state) => state.logs.logDetails);

  // Detect all unique scorer names across all logs from their results
  const scorerMap = useMemo(() => {
    const scoreTypes: Record<string, string> = {};

    for (const details of Object.values(logDetails)) {
      if (details.results?.scores) {
        // scores is an array of EvalScore objects
        for (const evalScore of details.results.scores) {
          // Each EvalScore has metrics which is a record of EvalMetric
          if (evalScore.metrics) {
            for (const [metricName, metric] of Object.entries(
              evalScore.metrics
            )) {
              scoreTypes[metricName] = typeof metric.value;
            }
          }
        }
      }
    }

    return scoreTypes;
  }, [logDetails]);

  // Auto-hide scorer columns by default if not explicitly set
  useEffect(() => {
    const scorerNames = Object.keys(scorerMap);
    if (scorerNames.length === 0) return;

    const needsUpdate = scorerNames.some(
      (name) => !(`score_${name}` in columnVisibility)
    );

    if (needsUpdate) {
      const newVisibility = { ...columnVisibility };
      for (const scorerName of scorerNames) {
        const field = `score_${scorerName}`;
        if (!(field in columnVisibility)) {
          newVisibility[field] = false;
        }
      }
      setColumnVisibility(newVisibility);
    }
  }, [scorerMap, columnVisibility, setColumnVisibility]);

  const allColumns = useMemo((): ColDef<LogListRow>[] => {
    const baseColumns: ColDef<LogListRow>[] = [
      {
        field: "type",
        headerName: "",
        initialWidth: 32,
        minWidth: 32,
        maxWidth: 32,
        suppressSizeToFit: true,
        sortable: true,
        filter: false,
        resizable: false,
        pinned: "left",
        cellRenderer: (params: ICellRendererParams<LogListRow>) => {
          const type = params.data?.type;
          const icon =
            type === "file" || type === "pending-task"
              ? ApplicationIcons.inspectFile
              : ApplicationIcons.folder;
          return (
            <div className={styles.iconCell}>
              <i className={clsx(icon)} />
            </div>
          );
        },
      },
      {
        field: "task",
        headerName: "Task",
        initialWidth: 250,
        minWidth: 150,
        sortable: true,
        filter: true,
        resizable: true,
        tooltipValueGetter: (params) => params.value || undefined,
        valueGetter: (params) => {
          const item = params.data;
          if (!item) return "";
          if (item.type === "file") {
            return item.task || parseLogFileName(item.name).name;
          }
          return item.name;
        },
        cellRenderer: (params: ICellRendererParams<LogListRow>) => {
          const item = params.data;
          if (!item) return null;
          let value = item.name;
          if (item.type === "file") {
            value = item.task || parseLogFileName(item.name).name;
          }
          return (
            <div className={styles.nameCell}>
              {item.type === "folder" && item.url ? (
                <span className={styles.folder}>{value}</span>
              ) : (
                <span className={styles.taskText}>{value}</span>
              )}
            </div>
          );
        },
      },
      {
        field: "model",
        headerName: "Model",
        initialWidth: 300,
        minWidth: 100,
        maxWidth: 400,
        sortable: true,
        filter: true,
        resizable: true,
        tooltipField: "model",
        cellRenderer: (params: ICellRendererParams<LogListRow>) => {
          const item = params.data;
          if (!item) return null;
          if (item.model) {
            return <div className={styles.modelCell}>{item.model}</div>;
          }
          return <EmptyCell />;
        },
      },
      {
        field: "score",
        headerName: "Score",
        initialWidth: 80,
        minWidth: 60,
        maxWidth: 120,
        sortable: true,
        filter: "agNumberColumnFilter",
        resizable: true,
        valueFormatter: (params) => {
          if (params.value === undefined || params.value === null) return "";
          return formatPrettyDecimal(params.value);
        },
        cellRenderer: (params: ICellRendererParams<LogListRow>) => {
          const item = params.data;
          if (!item || item.score === undefined) {
            return <EmptyCell />;
          }
          return (
            <div className={styles.scoreCell}>
              {formatPrettyDecimal(item.score)}
            </div>
          );
        },
      },
      {
        field: "status",
        headerName: "Status",
        initialWidth: 80,
        minWidth: 60,
        maxWidth: 100,
        sortable: true,
        filter: true,
        resizable: true,
        tooltipValueGetter: (params) => {
          const item = params.data;
          if (!item) return undefined;
          if (item.status === "error" && item.errorMessage) {
            return item.errorMessage;
          }
          return item.status || undefined;
        },
        cellRenderer: (params: ICellRendererParams<LogListRow>) => {
          const item = params.data;
          if (!item) return null;

          const status = item.status;

          if (!status && item.type !== "pending-task") {
            return <EmptyCell />;
          }

          const icon =
            item.type === "pending-task"
              ? ApplicationIcons.pendingTask
              : status === "error"
                ? ApplicationIcons.error
                : status === "started"
                  ? ApplicationIcons.running
                  : status === "cancelled"
                    ? ApplicationIcons.cancelled
                    : ApplicationIcons.success;

          const clz =
            item.type === "pending-task"
              ? styles.started
              : status === "error"
                ? styles.error
                : status === "started"
                  ? styles.started
                  : status === "cancelled"
                    ? styles.cancelled
                    : styles.success;

          return (
            <div className={styles.statusCell}>
              <i className={clsx(icon, clz)} />
            </div>
          );
        },
      },
      {
        field: "completedAt",
        headerName: "Completed",
        initialWidth: 130,
        minWidth: 80,
        maxWidth: 140,
        sortable: true,
        filter: true,
        resizable: true,
        cellDataType: "date",
        filterValueGetter: (params) => {
          if (!params.data?.completedAt) return undefined;
          const d = new Date(params.data.completedAt);
          return new Date(d.getFullYear(), d.getMonth(), d.getDate());
        },
        valueGetter: (params) => {
          const completed = params.data?.completedAt;
          if (!completed) return "";
          return formatDateTime(new Date(completed));
        },
        cellRenderer: (params: ICellRendererParams<LogListRow>) => {
          const completed = params.data?.completedAt;
          if (!completed) {
            return <EmptyCell />;
          }
          const timeStr = formatDateTime(new Date(completed));
          return <div className={styles.dateCell}>{timeStr}</div>;
        },
        comparator: createFolderFirstComparator<LogListRow>(comparators.date),
      },
      {
        field: "name",
        headerName: "File Name",
        initialWidth: 600,
        minWidth: 150,
        sortable: true,
        filter: true,
        resizable: true,
        tooltipValueGetter: (params) => params.value || undefined,
        valueGetter: (params) => {
          const item = params.data;
          if (!item) return "";
          if (item.type === "folder") return item.name;
          if (item.type === "file") return basename(item.name);
          return "";
        },
        cellRenderer: (params: ICellRendererParams<LogListRow>) => {
          const item = params.data;
          if (!item || item.type === "pending-task") {
            return <EmptyCell />;
          }
          if (item.type === "folder") {
            return (
              <div className={styles.nameCell}>
                <span className={styles.folder}>{item.name}</span>
              </div>
            );
          }
          const value = basename(item.name);
          return <div className={styles.nameCell}>{value}</div>;
        },
      },
      {
        field: "path",
        headerName: "Path",
        initialWidth: 300,
        minWidth: 100,
        sortable: true,
        filter: true,
        resizable: true,
        tooltipField: "path",
        cellRenderer: (params: ICellRendererParams<LogListRow>) => {
          const item = params.data;
          if (!item?.path) return <EmptyCell />;
          return <div className={styles.nameCell}>{item.path}</div>;
        },
      },
      {
        field: "totalSamples",
        headerName: "Samples",
        initialWidth: 90,
        minWidth: 60,
        maxWidth: 120,
        sortable: true,
        filter: "agNumberColumnFilter",
        resizable: true,
        cellRenderer: (params: ICellRendererParams<LogListRow>) => {
          if (params.value === undefined || params.value === null) {
            return <EmptyCell />;
          }
          return <div>{formatNumber(params.value)}</div>;
        },
      },
      {
        field: "completedSamples",
        headerName: "Completed Samples",
        initialWidth: 130,
        minWidth: 80,
        maxWidth: 160,
        sortable: true,
        filter: "agNumberColumnFilter",
        resizable: true,
        cellRenderer: (params: ICellRendererParams<LogListRow>) => {
          if (params.value === undefined || params.value === null) {
            return <EmptyCell />;
          }
          return <div>{formatNumber(params.value)}</div>;
        },
      },
      {
        field: "sandbox",
        headerName: "Sandbox",
        initialWidth: 100,
        minWidth: 60,
        maxWidth: 150,
        sortable: true,
        filter: true,
        resizable: true,
        cellRenderer: (params: ICellRendererParams<LogListRow>) => {
          if (!params.value) return <EmptyCell />;
          return <div>{params.value}</div>;
        },
      },
      {
        field: "totalTokens",
        headerName: "Tokens",
        initialWidth: 100,
        minWidth: 60,
        maxWidth: 140,
        sortable: true,
        filter: "agNumberColumnFilter",
        resizable: true,
        cellRenderer: (params: ICellRendererParams<LogListRow>) => {
          if (params.value === undefined || params.value === null) {
            return <EmptyCell />;
          }
          return <div>{formatNumber(params.value)}</div>;
        },
      },
      {
        field: "duration",
        headerName: "Duration",
        initialWidth: 120,
        minWidth: 70,
        maxWidth: 160,
        sortable: true,
        filter: "agNumberColumnFilter",
        resizable: true,
        valueFormatter: (params) => {
          if (params.value === undefined || params.value === null) return "";
          return formatTime(params.value);
        },
        cellRenderer: (params: ICellRendererParams<LogListRow>) => {
          if (params.value === undefined || params.value === null) {
            return <EmptyCell />;
          }
          return <div>{formatTime(params.value)}</div>;
        },
        tooltipValueGetter: (params) => {
          if (params.value === undefined || params.value === null) {
            return undefined;
          }
          return formatTime(params.value);
        },
      },
      {
        field: "taskFile",
        headerName: "Task File",
        initialWidth: 200,
        minWidth: 100,
        sortable: true,
        filter: true,
        resizable: true,
        tooltipField: "taskFile",
        cellRenderer: (params: ICellRendererParams<LogListRow>) => {
          if (!params.value) return <EmptyCell />;
          return <div className={styles.nameCell}>{params.value}</div>;
        },
      },
      {
        field: "taskArgs",
        headerName: "Task Args",
        initialWidth: 200,
        minWidth: 100,
        sortable: true,
        filter: true,
        resizable: true,
        cellRenderer: (params: ICellRendererParams<LogListRow>) => {
          if (!params.value) return <EmptyCell />;
          return <div className={styles.nameCell}>{params.value}</div>;
        },
        tooltipValueGetter: (params) => {
          const raw = params.data?.taskArgsRaw;
          if (!raw) return undefined;
          return JSON.stringify(raw, null, 2);
        },
        tooltipComponent: PreformattedTooltip,
      },
      {
        field: "tags",
        headerName: "Tags",
        initialWidth: 80,
        minWidth: 80,
        sortable: true,
        filter: true,
        resizable: true,
        valueGetter: (params) => {
          const tags = params.data?.tags;
          if (!tags || tags.length === 0) return "";
          return tags.join(", ");
        },
        tooltipValueGetter: (params) => params.value || undefined,
        cellRenderer: (params: ICellRendererParams<LogListRow>) => {
          if (!params.value) return <EmptyCell />;
          return <div className={styles.nameCell}>{params.value}</div>;
        },
      },
      {
        field: "percentCompleted",
        headerName: "% Completed",
        initialWidth: 110,
        minWidth: 80,
        maxWidth: 140,
        sortable: true,
        filter: "agNumberColumnFilter",
        resizable: true,
        valueFormatter: (params) => {
          if (params.value === undefined || params.value === null) return "";
          return `${formatPrettyDecimal(params.value)}%`;
        },
        cellRenderer: (params: ICellRendererParams<LogListRow>) => {
          if (params.value === undefined || params.value === null) {
            return <EmptyCell />;
          }
          return <div>{formatPrettyDecimal(params.value)}%</div>;
        },
      },
      {
        field: "sampleErrors",
        headerName: "Sample Errors",
        initialWidth: 110,
        minWidth: 60,
        maxWidth: 140,
        sortable: true,
        filter: "agNumberColumnFilter",
        resizable: true,
        cellRenderer: (params: ICellRendererParams<LogListRow>) => {
          if (params.value === undefined || params.value === null) {
            return <EmptyCell />;
          }
          return <div>{formatNumber(params.value)}</div>;
        },
      },
      {
        field: "errorMessage",
        headerName: "Error",
        initialWidth: 300,
        minWidth: 100,
        sortable: true,
        filter: true,
        resizable: true,
        valueGetter: (params) => {
          const msg = params.data?.errorMessage;
          if (!msg) return "";
          return msg.split("\n")[0];
        },
        tooltipValueGetter: (params) =>
          params.data?.errorMessage || undefined,
        cellRenderer: (params: ICellRendererParams<LogListRow>) => {
          if (!params.value) return <EmptyCell />;
          return <div className={styles.nameCell}>{params.value}</div>;
        },
      },
    ];

    // Add scorer columns (currently only showing when we detect them)
    const scorerColumns: ColDef<LogListRow>[] = Object.keys(scorerMap).map(
      (scorerName) => {
        const scoreType = scorerMap[scorerName];
        return {
          field: `score_${scorerName}`,
          headerName: scorerName,
          initialWidth: 100,
          minWidth: 100,
          sortable: true,
          filter:
            scoreType === "number"
              ? "agNumberColumnFilter"
              : "agTextColumnFilter",
          resizable: true,
          valueFormatter: (params) => {
            const value = params.value;
            if (value === "" || value === null || value === undefined) {
              return "";
            }
            if (typeof value === "number") {
              return formatPrettyDecimal(value);
            }
            return String(value);
          },
          cellRenderer: (params: ICellRendererParams<LogListRow>) => {
            const value = params.value;
            if (value === undefined || value === null || value === "") {
              return <EmptyCell />;
            }
            return (
              <div className={styles.scoreCell}>
                {formatPrettyDecimal(value)}
              </div>
            );
          },
          comparator: createFolderFirstComparator<LogListRow>((valA, valB) => {
            if (typeof valA === "number" && typeof valB === "number") {
              return valA - valB;
            }
            return String(valA || "").localeCompare(String(valB || ""));
          }),
        } as ColDef<LogListRow>;
      }
    );

    const allCols = [...baseColumns, ...scorerColumns];

    if (mode === "tasks") {
      // Tasks view: remove the type icon column (no folders in flat view)
      const typeIdx = allCols.findIndex((col) => col.field === "type");
      if (typeIdx >= 0) {
        allCols.splice(typeIdx, 1);
      }

      // Tasks view column order
      const tasksFieldOrder = [
        "status",
        "task",
        "model",
        "taskArgs",
        "tags",
        "score",
        "completedAt",
        "totalSamples",
        "completedSamples",
        "percentCompleted",
        "sampleErrors",
        "totalTokens",
        "duration",
        "errorMessage",
        "name",
        "sandbox",
        "taskFile",
      ];
      allCols.sort((a, b) => {
        const aIdx = tasksFieldOrder.indexOf(a.field || "");
        const bIdx = tasksFieldOrder.indexOf(b.field || "");
        // Fields in the order list come first, in specified order
        // Fields not in the list (scorer columns) go after
        const aOrder = aIdx >= 0 ? aIdx : tasksFieldOrder.length;
        const bOrder = bIdx >= 0 ? bIdx : tasksFieldOrder.length;
        return aOrder - bOrder;
      });
    } else {
      // Logs view: move "name" (File Name) to be the second column (after the type icon)
      const nameIdx = allCols.findIndex((col) => col.field === "name");
      if (nameIdx > 1) {
        const [nameCol] = allCols.splice(nameIdx, 1);
        allCols.splice(1, 0, nameCol);
      }

      // move "status" to be right after the name column
      const statusIdx = allCols.findIndex((col) => col.field === "status");
      if (statusIdx > 2) {
        const [statusCol] = allCols.splice(statusIdx, 1);
        allCols.splice(2, 0, statusCol);
      }
    }

    return allCols;
  }, [scorerMap, mode]);

  // Default hidden columns per mode
  const defaultHiddenFields = useMemo(() => {
    const hidden = new Set<string>();
    if (mode === "tasks") {
      // Tasks: hide completedSamples, sandbox, taskFile by default
      hidden.add("sandbox");
      hidden.add("taskFile");
      hidden.add("name");
      hidden.add("path");
      hidden.add("completedSamples");
    } else {
      // Logs: hide path, completedSamples, sandbox, taskFile by default
      hidden.add("path");
      hidden.add("completedSamples");
      hidden.add("sandbox");
      hidden.add("taskFile");
    }
    // New columns default to hidden in both views
    hidden.add("percentCompleted");
    hidden.add("sampleErrors");
    hidden.add("errorMessage");
    return hidden;
  }, [mode]);

  const columns = useMemo((): ColDef<LogListRow>[] => {
    const columnsWithVisibility = allColumns.map((col: ColDef<LogListRow>) => {
      const field = getFieldKey(col);
      const isScoreColumn = field.startsWith("score_");
      const defaultVisible = isScoreColumn
        ? false
        : !defaultHiddenFields.has(field);
      const isVisible = columnVisibility[field] ?? defaultVisible;
      return {
        ...col,
        hide: !isVisible,
      };
    });

    return columnsWithVisibility;
  }, [allColumns, columnVisibility, defaultHiddenFields]);

  return {
    columns,
    setColumnVisibility,
  };
};
