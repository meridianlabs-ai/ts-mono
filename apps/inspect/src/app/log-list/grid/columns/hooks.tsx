import type {
  ColDef,
  ICellRendererParams,
  ValueGetterParams,
} from "ag-grid-community";
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

/**
 * Build a stable, unique column key for a (scorer, metric) pair. The reducer
 * is intentionally omitted so the same logical metric is one column regardless
 * of whether the log recorded `reducer=null` (default, silently mean) or
 * `reducer="mean"` (explicit). "/" is used as separator because ag-grid treats
 * "." in `field` as nested-object access.
 */
const scorerMetricKey = (scorerName: string, metricName: string): string =>
  `${scorerName}/${metricName}`;

/** Human-readable header: "scorer / metric". */
const scorerMetricHeader = (
  scorerName: string,
  metricName: string
): string => `${scorerName} / ${metricName}`;

/**
 * Field key for the synthetic "by metric" column that aggregates across
 * scorers. Uses a `metric_` prefix (no slash) so it can never collide with
 * the per-scorer `score_<scorer>/<metric>` field keys.
 */
const byMetricField = (metricName: string): string => `metric_${metricName}`;

export type LogListMode = "logs" | "tasks";
export type ScoresViewMode = "by-metric" | "per-scorer";

export const useLogListColumns = (
  mode: LogListMode = "logs",
  /**
   * When set, scorer columns are computed only from logs whose name starts
   * with this prefix. Used by the folder view so descending into a subfolder
   * recomputes the Metrics list to match the contents of that folder.
   */
  scopePrefix?: string,
  /**
   * View mode for scorer columns:
   *   - "by-metric" (default): one synthetic column per unique metric name,
   *     aggregating across scorers via valueGetter.
   *   - "per-scorer": one column per (scorer, metric) pair, fully qualified.
   */
  viewMode: ScoresViewMode = "by-metric"
): {
  /** Full column set for the grid. Both score-column modes are registered,
   *  with inactive-mode columns marked hide:true so the grid's structure
   *  (and base-column widths) stay stable when the mode is toggled. */
  columns: ColDef<LogListRow>[];
  /** Subset passed to the ColumnSelectorPopover so the picker only lists
   *  checkboxes for the currently active view mode. */
  pickerColumns: ColDef<LogListRow>[];
  setColumnVisibility: (visibility: Record<string, boolean>) => void;
} => {
  const columnVisibility = useStore(
    (state) => state.logs.listing.columnVisibility
  );
  const setColumnVisibility = useStore(
    (state) => state.logsActions.setLogsColumnVisibility
  );
  const logDetails = useStore((state) => state.logs.logDetails);

  // Detect all unique (scorer, reducer, metric) combinations across all logs
  // from their results. Previously this collapsed on metric name alone, which
  // merged distinct scorers emitting the same metric (e.g. two "accuracy"s)
  // into a single column.
  const scorerMap = useMemo(() => {
    const info: Record<
      string,
      { scorerName: string; metricName: string; valueType: string }
    > = {};

    for (const [logName, details] of Object.entries(logDetails)) {
      if (scopePrefix && !logName.startsWith(scopePrefix)) {
        continue;
      }
      if (details.results?.scores) {
        for (const evalScore of details.results.scores) {
          if (evalScore.metrics) {
            for (const [metricName, metric] of Object.entries(
              evalScore.metrics
            )) {
              const key = scorerMetricKey(evalScore.name, metricName);
              info[key] = {
                scorerName: evalScore.name,
                metricName,
                valueType: typeof metric.value,
              };
            }
          }
        }
      }
    }

    return info;
  }, [logDetails, scopePrefix]);

  // Auto-hide scorer columns by default if not explicitly set. Seed defaults
  // for BOTH the per-scorer fields (`score_<scorer>/<metric>`) and the
  // synthetic by-metric fields (`metric_<metric>`) so switching view modes
  // never produces an un-initialised column, and a user's toggles in each
  // mode persist independently.
  useEffect(() => {
    const scorerKeys = Object.keys(scorerMap);
    if (scorerKeys.length === 0) return;

    const metricNames = new Set<string>();
    for (const { metricName } of Object.values(scorerMap)) {
      metricNames.add(metricName);
    }

    const allFields = [
      ...scorerKeys.map((key) => `score_${key}`),
      ...[...metricNames].map(byMetricField),
    ];

    const needsUpdate = allFields.some(
      (field) => !(field in columnVisibility)
    );

    if (needsUpdate) {
      const newVisibility = { ...columnVisibility };
      for (const field of allFields) {
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
        tooltipValueGetter: (params) => params.data?.errorMessage || undefined,
        cellRenderer: (params: ICellRendererParams<LogListRow>) => {
          if (!params.value) return <EmptyCell />;
          return <div className={styles.nameCell}>{params.value}</div>;
        },
      },
    ];

    // Per-scorer columns: one per (scorer, metric) pair. Alphabetical key
    // order so the column sequence is stable regardless of log iteration.
    const scorerKeys = Object.keys(scorerMap).sort((a, b) => a.localeCompare(b));
    const perScorerColumns: ColDef<LogListRow>[] = scorerKeys.map((key) => {
      const { scorerName, metricName, valueType } = scorerMap[key];
      const scoreType = valueType;
      return {
        field: `score_${key}`,
        headerName: scorerMetricHeader(scorerName, metricName),
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
    });

    // By-metric columns: one synthetic column per unique metric name across
    // all scorers. Each column's valueGetter reads the row's per-scorer fields
    // in alphabetical scorer order and returns the first non-empty value.
    // The cellRenderer additionally renders a "+N" badge with a tooltip when
    // more than one scorer on the same row produced the metric.
    const metricGroups = new Map<
      string,
      { scorerName: string; valueType: string }[]
    >();
    for (const { scorerName, metricName, valueType } of Object.values(
      scorerMap
    )) {
      const list = metricGroups.get(metricName) ?? [];
      list.push({ scorerName, valueType });
      metricGroups.set(metricName, list);
    }

    const byMetricColumns: ColDef<LogListRow>[] = [...metricGroups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([metricName, entries]) => {
        const scorerOrder = entries
          .map((e) => e.scorerName)
          .sort((a, b) => a.localeCompare(b));
        const allNumeric = entries.every((e) => e.valueType === "number");

        const readContributors = (
          row: LogListRow | undefined
        ): { scorer: string; value: unknown }[] => {
          if (!row) return [];
          const contributors: { scorer: string; value: unknown }[] = [];
          for (const scorer of scorerOrder) {
            const v = row[`score_${scorer}/${metricName}`];
            if (v !== undefined && v !== null && v !== "") {
              contributors.push({ scorer, value: v });
            }
          }
          return contributors;
        };

        return {
          field: byMetricField(metricName),
          headerName: metricName,
          initialWidth: 100,
          minWidth: 100,
          sortable: true,
          filter: allNumeric
            ? "agNumberColumnFilter"
            : "agTextColumnFilter",
          resizable: true,
          valueGetter: (params: ValueGetterParams<LogListRow>) => {
            const first = readContributors(params.data)[0];
            return first?.value;
          },
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
            const contributors = readContributors(params.data);
            if (contributors.length === 0) return <EmptyCell />;
            const primary = contributors[0].value;
            const extras = contributors.slice(1);
            const primaryText =
              typeof primary === "number"
                ? formatPrettyDecimal(primary)
                : String(primary);
            return (
              <div className={styles.scoreCell}>
                {primaryText}
                {extras.length > 0 && (
                  <span
                    className={styles.multiScorerBadge}
                    title={extras
                      .map((c) => {
                        const v =
                          typeof c.value === "number"
                            ? formatPrettyDecimal(c.value)
                            : String(c.value);
                        return `${c.scorer}: ${v}`;
                      })
                      .join("\n")}
                  >
                    +{extras.length}
                  </span>
                )}
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
      });

    // Always include BOTH score-column sets so the grid's column structure
    // is stable across view-mode toggles — switching just flips `hide` on
    // each column rather than swapping in an entirely new column array,
    // which keeps ag-grid from reflowing base-column widths.
    const allCols = [
      ...baseColumns,
      ...perScorerColumns,
      ...byMetricColumns,
    ];

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

  // Determine whether a column belongs to the active scores view mode. Base
  // columns (neither prefix) always match. Per-scorer and by-metric columns
  // only match when the corresponding mode is selected.
  const matchesActiveMode = (field: string): boolean => {
    if (field.startsWith("score_")) return viewMode === "per-scorer";
    if (field.startsWith("metric_")) return viewMode === "by-metric";
    return true;
  };

  const columns = useMemo((): ColDef<LogListRow>[] => {
    const columnsWithVisibility = allColumns.map((col: ColDef<LogListRow>) => {
      const field = getFieldKey(col);
      const isScoreColumn =
        field.startsWith("score_") || field.startsWith("metric_");
      const defaultVisible = isScoreColumn
        ? false
        : !defaultHiddenFields.has(field);
      const isVisible = columnVisibility[field] ?? defaultVisible;
      // Grid visibility is driven purely by the user's per-field toggle —
      // switching view modes only affects which checkboxes the popover
      // shows, never what's rendered in the grid.
      return {
        ...col,
        hide: !isVisible,
      };
    });

    return columnsWithVisibility;
  }, [allColumns, columnVisibility, defaultHiddenFields]);

  // Columns to show in the ColumnSelectorPopover. The grid needs both score
  // column sets registered for layout stability, but the picker should only
  // list the checkboxes relevant to the current view mode.
  const pickerColumns = useMemo((): ColDef<LogListRow>[] => {
    return columns.filter((col) => matchesActiveMode(getFieldKey(col)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- matchesActiveMode is recreated each render but is safe to exclude
  }, [columns, viewMode]);

  return {
    columns,
    pickerColumns,
    setColumnVisibility,
  };
};
