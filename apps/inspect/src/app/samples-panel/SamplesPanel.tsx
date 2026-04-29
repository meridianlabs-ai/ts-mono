import type {
  ColDef,
  GetRowIdParams,
  GridApi,
  GridState,
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import clsx from "clsx";
import { FC, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { inputString } from "@tsmono/inspect-common/utils";
import { ProgressBar } from "@tsmono/react/components";

import { ActivityBar } from "../../components/ActivityBar";
import { useClientEvents } from "../../state/clientEvents";
import {
  LogHandleWithretried,
  useLogs,
  useLogsWithretried,
} from "../../state/hooks";
import { useStore } from "../../state/store";
import { join } from "../../utils/uri";
import { ApplicationIcons } from "../appearance/icons";
import { FlowButton } from "../flow/FlowButton";
import { useFlowServerData } from "../flow/hooks";
import { LogListFooter } from "../log-list/LogListFooter";
import { ApplicationNavbar } from "../navbar/ApplicationNavbar";
import { NavbarButton } from "../navbar/NavbarButton";
import { ViewSegmentedControl } from "../navbar/ViewSegmentedControl";
import { useSamplesGridNavigation } from "../routing/sampleNavigation";
import { samplesUrl, useSamplesRouteParams } from "../routing/url";
import { ColumnSelectorPopover } from "../shared/ColumnSelectorPopover";
import { getFieldKey } from "../shared/gridUtils";
import {
  buildSampleColumns,
  SCORE_FIELD_RAW_PREFIX,
} from "../shared/samples-grid/columns";
import { SamplesGrid } from "../shared/samples-grid/SamplesGrid";
import { SampleRow } from "../shared/samples-grid/types";
import { useSampleGridState } from "../shared/samples-grid/useSampleGridState";
import { DisplayedSample } from "../types";

import styles from "./SamplesPanel.module.css";

const sampleRowId = (
  logFile: string,
  sampleId: string | number,
  epoch: number
) => `${logFile}-${sampleId}-${epoch}`.replace(/\s+/g, "_");

const gridDisplayedSamples = (api: GridApi<SampleRow>): DisplayedSample[] => {
  const out: DisplayedSample[] = [];
  const count = api.getDisplayedRowCount();
  for (let i = 0; i < count; i++) {
    const node = api.getDisplayedRowAtIndex(i);
    if (node?.data) {
      out.push({
        logFile: node.data.logFile,
        sampleId: node.data.sampleId,
        epoch: node.data.epoch,
      });
    }
  }
  return out;
};

export const SamplesPanel: FC = () => {
  const { samplesPath } = useSamplesRouteParams();
  const { loadLogs } = useLogs();
  const logDir = useStore((state) => state.logs.logDir);

  const loading = useStore((state) => state.app.status.loading);
  const syncing = useStore((state) => state.app.status.syncing);
  const showRetriedLogs = useStore((state) => state.logs.showRetriedLogs);
  const setShowRetriedLogs = useStore(
    (state) => state.logsActions.setShowRetriedLogs
  );

  const filteredSamplesCount = useStore(
    (state) => state.log.filteredSampleCount
  );
  const setFilteredSampleCount = useStore(
    (state) => state.logActions.setFilteredSampleCount
  );
  const setDisplayedSamples = useStore(
    (state) => state.logsActions.setDisplayedSamples
  );
  const clearDisplayedSamples = useStore(
    (state) => state.logsActions.clearDisplayedSamples
  );
  const clearSelectedSample = useStore(
    (state) => state.sampleActions.clearSelectedSample
  );
  const previousSamplesPath = useStore(
    (state) => state.logs.samplesListState.previousSamplesPath
  );
  const setPreviousSamplesPath = useStore(
    (state) => state.logsActions.setPreviousSamplesPath
  );

  const selectedLogFile = useStore((state) => state.logs.selectedLogFile);
  const selectedSampleHandle = useStore(
    (state) => state.log.selectedSampleHandle
  );

  const gridRef = useRef<AgGridReact<SampleRow>>(null);
  const [showColumnSelector, setShowColumnSelector] = useState(false);
  const columnButtonRef = useRef<HTMLButtonElement>(null);

  const logDetails = useStore((state) => state.logs.logDetails);

  // Polling for updated log files.
  const { startPolling, stopPolling } = useClientEvents();
  useEffect(() => {
    startPolling([]);
    return () => {
      stopPolling();
    };
  }, [startPolling, stopPolling]);

  useFlowServerData(samplesPath || "");
  const flowData = useStore((state) => state.logs.flow);

  const currentDir = join(samplesPath || "", logDir);

  const evalSet = useStore((state) => state.logs.evalSet);
  const logFiles = useLogsWithretried();
  const logPreviews = useStore((state) => state.logs.logPreviews);

  const currentDirLogFiles = useMemo(() => {
    const files = [];
    for (const logFile of logFiles) {
      const inCurrentDir = logFile.name.startsWith(currentDir);
      const skipped = !showRetriedLogs && logFile.retried;
      if (inCurrentDir && !skipped) {
        files.push(logFile);
      }
    }
    return files;
  }, [currentDir, logFiles, showRetriedLogs]);

  const totalTaskCount = useMemo(() => {
    const currentDirTaskIds = new Set(currentDirLogFiles.map((f) => f.task_id));
    let count = currentDirLogFiles.length;
    for (const task of evalSet?.tasks || []) {
      if (!currentDirTaskIds.has(task.task_id)) {
        count++;
      }
    }
    return count;
  }, [currentDirLogFiles, evalSet]);

  const completedTaskCount = useMemo(() => {
    let count = 0;
    for (const logFile of currentDirLogFiles) {
      const preview = logPreviews[logFile.name];
      if (preview && preview.status !== "started") {
        count++;
      }
    }
    return count;
  }, [logPreviews, currentDirLogFiles]);

  useEffect(() => {
    loadLogs(samplesPath);
  }, [loadLogs, samplesPath]);

  // Filter logDetails based on samplesPath.
  const logDetailsInPath = useMemo(() => {
    if (!samplesPath) return logDetails;
    const samplesPathAbs = join(samplesPath, logDir);
    return Object.entries(logDetails).reduce(
      (acc, [logFile, details]) => {
        if (logFile.startsWith(samplesPathAbs)) {
          acc[logFile] = details;
        }
        return acc;
      },
      {} as typeof logDetails
    );
  }, [logDetails, logDir, samplesPath]);

  // Build the superset of columns.
  const allColumns = useMemo(
    () =>
      buildSampleColumns({
        viewMode: "grid",
        multiLog: true,
        logDetails: logDetailsInPath,
      }),
    [logDetailsInPath]
  );

  // Default visibility for unseeded columns. `error`/`limit`/`retries`
  // auto-promote to visible when at least one sample carries that field.
  const optionalHasData = useMemo(() => {
    let error = false,
      limit = false,
      retries = false;
    outer: for (const details of Object.values(logDetailsInPath)) {
      for (const sample of details.sampleSummaries) {
        if (sample.error) error = true;
        if (sample.limit) limit = true;
        if (sample.retries) retries = true;
        if (error && limit && retries) break outer;
      }
    }
    return { error, limit, retries };
  }, [logDetailsInPath]);

  const defaultsForUnseededColumns = useCallback(
    (col: ColDef<SampleRow>) => {
      const id = col.colId;
      if (id === "error") return optionalHasData.error;
      if (id === "limit") return optionalHasData.limit;
      if (id === "retries") return optionalHasData.retries;
      // `created` defaults off — many users won't care.
      if (id === "created") return false;
      return true;
    },
    [optionalHasData]
  );

  const { columnVisibility, setColumnVisibility, gridState, setGridState } =
    useSampleGridState<SampleRow>("samplesPanel", allColumns, {
      defaultsForUnseededColumns,
      gridRef,
    });

  // Visibility is applied inside `<SamplesGrid>` via the ag-grid api so
  // the column defs themselves stay stable across visibility changes —
  // necessary for user-driven width/reorder to persist.
  const visibilityForGrid = useMemo<Record<string, boolean>>(() => {
    const v: Record<string, boolean> = {};
    for (const col of allColumns) {
      const key = getFieldKey(col);
      const seeded = columnVisibility[key];
      v[key] = seeded === undefined ? !col.hide : seeded;
    }
    return v;
  }, [allColumns, columnVisibility]);

  // Drop the persisted filter when samplesPath changes — surviving
  // column / sort settings are still useful, but a filter scoped to the
  // prior directory isn't. Pure: state mutations live in the effects
  // below.
  const initialState = useMemo<GridState | undefined>(() => {
    if (
      previousSamplesPath !== undefined &&
      previousSamplesPath !== samplesPath
    ) {
      const result = { ...gridState };
      delete result?.filter;
      return result;
    }
    return gridState;
  }, [previousSamplesPath, samplesPath, gridState]);

  useEffect(() => {
    if (samplesPath === previousSamplesPath) return;
    if (previousSamplesPath !== undefined) clearDisplayedSamples();
    setPreviousSamplesPath(samplesPath);
  }, [
    samplesPath,
    previousSamplesPath,
    clearDisplayedSamples,
    setPreviousSamplesPath,
  ]);

  // Transform logDetails into flat rows.
  const [sampleRows, hasRetriedLogs] = useMemo(() => {
    const allRows: SampleRow[] = [];
    let displayIndex = 1;

    let anyLogInCurrentDirCouldBeSkipped = false;
    const logInCurrentDirByName = currentDirLogFiles.reduce(
      (acc: Record<string, LogHandleWithretried>, log) => {
        if (log.retried) anyLogInCurrentDirCouldBeSkipped = true;
        acc[log.name] = log;
        return acc;
      },
      {}
    );

    Object.entries(logDetailsInPath).forEach(([logFile, logDetail]) => {
      logDetail.sampleSummaries.forEach((sample) => {
        const tokens = sample.model_usage
          ? Object.values(sample.model_usage).reduce(
              (sum, u) => sum + (u.total_tokens ?? 0),
              0
            )
          : undefined;
        const row: SampleRow = {
          logFile,
          sampleId: sample.id,
          epoch: sample.epoch,
          data: sample,
          displayIndex: displayIndex++,
          created: logDetail.eval.created,
          task: logDetail.eval.task || "",
          model: logDetail.eval.model || "",
          status: logDetail.status,
          input: inputString(sample.input).join("\n"),
          target: Array.isArray(sample.target)
            ? sample.target.join(", ")
            : (sample.target as string | undefined),
          error: sample.error,
          limit: sample.limit,
          retries: sample.retries,
          completed: sample.completed ?? false,
          tokens,
          duration: sample.total_time ?? undefined,
        };
        if (sample.scores) {
          for (const [scoreName, score] of Object.entries(sample.scores)) {
            row[`${SCORE_FIELD_RAW_PREFIX}${scoreName}`] = score.value;
          }
        }
        allRows.push(row);
      });
    });

    const _sampleRows = allRows.filter(
      (row) => row.logFile in logInCurrentDirByName
    );
    const _hasRetriedLogs =
      _sampleRows.length < allRows.length || anyLogInCurrentDirCouldBeSkipped;

    return [_sampleRows, _hasRetriedLogs];
  }, [logDetailsInPath, currentDirLogFiles]);

  const { navigateToSampleDetail } = useSamplesGridNavigation();
  const handleRowOpen = useCallback(
    (row: SampleRow, opts: { newWindow: boolean }) => {
      navigateToSampleDetail(
        row.logFile,
        row.sampleId,
        row.epoch,
        opts.newWindow
      );
    },
    [navigateToSampleDetail]
  );

  // Tracked here (not read straight off `gridRef.current.api`) so the
  // navbar's Reset Filters button and the column-selector's filter-icon
  // re-render when filters actually change.
  const [filteredFields, setFilteredFields] = useState<string[]>([]);
  const hasFilter = filteredFields.length > 0;

  const updateDisplayedFromApi = useCallback(
    (api: GridApi<SampleRow>) => {
      const displayed = gridDisplayedSamples(api);
      setFilteredSampleCount(displayed.length);
      setDisplayedSamples(displayed);
      setFilteredFields(Object.keys(api.getFilterModel() ?? {}));
    },
    [setFilteredSampleCount, setDisplayedSamples]
  );

  const handleFirstDataRendered = useCallback(
    (api: GridApi<SampleRow>) => {
      updateDisplayedFromApi(api);
      clearSelectedSample();
    },
    [updateDisplayedFromApi, clearSelectedSample]
  );

  const getRowId = useCallback(
    (params: GetRowIdParams<SampleRow>) =>
      sampleRowId(params.data.logFile, params.data.sampleId, params.data.epoch),
    []
  );

  const selectedRowId =
    selectedSampleHandle && selectedLogFile
      ? sampleRowId(
          selectedLogFile,
          selectedSampleHandle.id,
          selectedSampleHandle.epoch
        )
      : undefined;

  const isEmptyAndLoading = sampleRows.length === 0 && (loading > 0 || syncing);

  const handleResetFilters = () => {
    if (gridRef.current?.api) gridRef.current.api.setFilterModel(null);
  };

  return (
    <div className={clsx(styles.panel)}>
      <ApplicationNavbar currentPath={samplesPath} fnNavigationUrl={samplesUrl}>
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
            onClick={() => {
              setShowRetriedLogs(!showRetriedLogs);
              setTimeout(() => {
                if (gridRef.current) {
                  setFilteredSampleCount(
                    gridRef.current.api.getDisplayedRowCount()
                  );
                }
              }, 10);
            }}
          />
        )}
        <NavbarButton
          key="choose-columns"
          ref={columnButtonRef}
          label="Columns"
          icon={ApplicationIcons.columns}
          dropdown
          subtle
          onClick={(e) => {
            e.stopPropagation();
            setShowColumnSelector((prev) => !prev);
          }}
        />

        <ViewSegmentedControl selectedSegment="samples" />
        {flowData && <FlowButton />}
      </ApplicationNavbar>

      <ColumnSelectorPopover
        showing={showColumnSelector}
        setShowing={setShowColumnSelector}
        columns={allColumns}
        visibility={visibilityForGrid}
        onVisibilityChange={setColumnVisibility}
        positionEl={columnButtonRef.current}
        filteredFields={filteredFields}
        scoresHeading="Scores"
      />

      <ActivityBar animating={!!loading} />
      <div className={clsx(styles.list, "text-size-smaller")}>
        <SamplesGrid<SampleRow>
          rowData={sampleRows}
          columnDefs={allColumns}
          columnVisibility={visibilityForGrid}
          defaultColDef={{ sortable: true, filter: true, resizable: true }}
          viewMode="grid"
          gridRef={gridRef}
          getRowId={getRowId}
          selectedRowId={selectedRowId}
          onRowOpen={handleRowOpen}
          initialState={initialState}
          onStateUpdated={setGridState}
          onFilterChanged={updateDisplayedFromApi}
          onFirstDataRendered={handleFirstDataRendered}
          loading={isEmptyAndLoading}
        />
      </div>

      <LogListFooter
        itemCount={filteredSamplesCount ?? 0}
        itemCountLabel={filteredSamplesCount === 1 ? "sample" : "samples"}
        progressText={
          syncing
            ? `Syncing${filteredSamplesCount ? ` (${filteredSamplesCount.toLocaleString()} samples)` : ""}`
            : undefined
        }
        progressBar={
          totalTaskCount !== completedTaskCount ? (
            <ProgressBar
              min={0}
              max={totalTaskCount}
              value={completedTaskCount}
              width="100px"
              label={"tasks"}
            />
          ) : undefined
        }
      />
    </div>
  );
};
