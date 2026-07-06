import type { SortingState } from "@tanstack/react-table";
import type { ColDef } from "ag-grid-community";
import clsx from "clsx";
import { FC, useCallback, useEffect, useMemo, useState } from "react";

import { inputString, totalModelFallbacks } from "@tsmono/inspect-common/utils";
import { ProgressBar } from "@tsmono/react/components";

import { useLogDir } from "../../app_config";
import { ActivityBar } from "../../components/ActivityBar";
import {
  LogListingRow,
  useLogListing,
  useLogsSync,
  useSamplesListing,
} from "../../log_data";
import { selectSample } from "../../state/actions";
import { useStore } from "../../state/store";
import { useUserSettings } from "../../state/userSettings";
import { join } from "../../utils/uri";
import { ApplicationIcons } from "../appearance/icons";
import { FlowButton } from "../flow/FlowButton";
import { useFlowQuery } from "../flow/hooks";
import { LogListFooter } from "../log-list/LogListFooter";
import { ApplicationNavbar } from "../navbar/ApplicationNavbar";
import { NavbarButton } from "../navbar/NavbarButton";
import { ViewSegmentedControl } from "../navbar/ViewSegmentedControl";
import { useSamplesGridNavigationAction } from "../routing/sampleNavigation";
import { samplesUrl, useSamplesRouteParams } from "../routing/url";
import { useEvalSet } from "../server/useEvalSet";
import { ColumnSelectorPopover } from "../shared/ColumnSelectorPopover";
import { ExtendedColumnDef } from "../shared/data-grid/columnTypes";
import {
  buildSampleColumns,
  SCORE_FIELD_RAW_PREFIX,
} from "../shared/samples-grid/columns";
import { SamplesGrid } from "../shared/samples-grid/SamplesGrid";
import { SampleRow } from "../shared/samples-grid/types";
import { useSampleGridState } from "../shared/samples-grid/useSampleGridState";

import styles from "./SamplesPanel.module.css";

// Cross-log default: most-recently-completed first (matches the prior AG view).
const kSamplesPanelDefaultSorting: SortingState = [
  { id: "completed_at", desc: true },
];

const sampleRowId = (
  logFile: string,
  sampleId: string | number,
  epoch: number
) => `${logFile}-${sampleId}-${epoch}`.replace(/\s+/g, "_");

// AG-shaped shim of the column list for the still-AG `useSampleGridState` /
// `ColumnSelectorPopover`, which key off `colId` / `headerName`.
const toPickerColumns = (
  columns: ExtendedColumnDef<SampleRow>[]
): ColDef<SampleRow>[] =>
  columns.map((col) => ({
    colId: col.id,
    headerName: typeof col.header === "string" ? col.header : "",
  }));

const completedAtTime = (row: SampleRow): number => {
  const v = row.data?.completed_at;
  return v ? new Date(v).getTime() : 0;
};

export const SamplesPanel: FC = () => {
  const { samplesPath } = useSamplesRouteParams();
  const logDir = useLogDir();

  // Sync the listing for this panel's scope; busy/error derive from its status.
  const listing = useLogsSync(logDir, samplesPath ?? "");
  const showRetriedLogs = useUserSettings((state) => state.showRetriedLogs);
  const setShowRetriedLogs = useUserSettings(
    (state) => state.setShowRetriedLogs
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

  const selectedSampleHandle = useStore(
    (state) => state.log.selectedSampleHandle
  );

  const [showColumnSelector, setShowColumnSelector] = useState(false);
  const [columnButtonEl, setColumnButtonEl] =
    useState<HTMLButtonElement | null>(null);

  const flowData = useFlowQuery(samplesPath || "").data;

  const currentDir = join(samplesPath || "", logDir);

  // Every sample summary under this panel's scope, each row carrying its
  // log's display context (the subsystem joins; no by-name lookups here).
  const scopedSamples = useSamplesListing({
    logDir,
    scope: { prefix: currentDir },
  });

  const evalSet = useEvalSet().data;
  const logFiles = useLogListing(logDir);

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
      if (logFile.status !== undefined && logFile.status !== "started") {
        count++;
      }
    }
    return count;
  }, [currentDirLogFiles]);

  // Build the superset of columns.
  const allColumns = useMemo(
    () =>
      buildSampleColumns({
        viewMode: "grid",
        multiLog: true,
        samples: scopedSamples.map((row) => row.summary),
      }),
    [scopedSamples]
  );

  const pickerColumns = useMemo(
    () => toPickerColumns(allColumns),
    [allColumns]
  );

  // Default visibility for unseeded columns. `error`/`limit`/`retries`/
  // `fallbacks` auto-promote to visible when at least one sample carries
  // that field.
  const optionalHasData = useMemo(() => {
    let error = false,
      limit = false,
      retries = false,
      fallbacks = false;
    for (const { summary } of scopedSamples) {
      if (summary.error) error = true;
      if (summary.limit) limit = true;
      if (summary.retries) retries = true;
      if (summary.model_fallbacks?.length) fallbacks = true;
      if (error && limit && retries && fallbacks) break;
    }
    return { error, limit, retries, fallbacks };
  }, [scopedSamples]);

  const defaultsForUnseededColumns = useCallback(
    (col: ColDef<SampleRow>) => {
      const id = col.colId;
      if (id === "error") return optionalHasData.error;
      if (id === "limit") return optionalHasData.limit;
      if (id === "retries") return optionalHasData.retries;
      if (id === "fallbacks") return optionalHasData.fallbacks;
      // `created` defaults off — many users won't care.
      if (id === "created") return false;
      if (id === "sampleUuid") return false;
      return true;
    },
    [optionalHasData]
  );

  const { columnVisibility, setColumnVisibility } =
    useSampleGridState<SampleRow>("samplesPanel", pickerColumns, {
      defaultsForUnseededColumns,
    });

  // Controlled visibility map keyed by column id, consumed by the DataGrid.
  const visibilityForGrid = useMemo<Record<string, boolean>>(() => {
    const v: Record<string, boolean> = {};
    for (const col of allColumns) {
      const key = col.id ?? "";
      const seeded = columnVisibility[key];
      v[key] = seeded === undefined ? true : seeded;
    }
    return v;
  }, [allColumns, columnVisibility]);

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

  // Transform the scoped samples into flat grid rows, pre-sorted by
  // completion time (descending) since interactive sorting is deferred.
  const [sampleRows, hasRetriedLogs] = useMemo(() => {
    let displayIndex = 1;

    const anyLogInCurrentDirCouldBeSkipped = currentDirLogFiles.some(
      (log) => log.retried
    );
    const logInCurrentDirByName = currentDirLogFiles.reduce(
      (acc: Record<string, LogListingRow>, log) => {
        acc[log.name] = log;
        return acc;
      },
      {}
    );

    const allRows: SampleRow[] = scopedSamples.map(
      ({ logFile, summary: sample, log }) => {
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
          created: log.created ?? "",
          task: log.task || "",
          model: log.model || "",
          status: log.status,
          input: inputString(sample.input).join("\n"),
          target: Array.isArray(sample.target)
            ? sample.target.join(", ")
            : sample.target,
          error: sample.error,
          limit: sample.limit,
          retries: sample.retries,
          fallbacks: totalModelFallbacks(sample.model_fallbacks) || undefined,
          completed: sample.completed,
          tokens,
          duration: sample.total_time ?? undefined,
        };
        if (sample.scores) {
          for (const [scoreName, score] of Object.entries(sample.scores)) {
            row[`${SCORE_FIELD_RAW_PREFIX}${scoreName}`] = score.value;
          }
        }
        return row;
      }
    );

    const _sampleRows = allRows.filter(
      (row) => row.logFile in logInCurrentDirByName
    );
    // Sort by completion time descending, then assign the display index so
    // the `#` column matches the rendered order.
    _sampleRows.sort((a, b) => completedAtTime(b) - completedAtTime(a));
    for (const row of _sampleRows) {
      row.displayIndex = displayIndex++;
    }
    const _hasRetriedLogs =
      _sampleRows.length < allRows.length || anyLogInCurrentDirCouldBeSkipped;

    return [_sampleRows, _hasRetriedLogs];
  }, [scopedSamples, currentDirLogFiles]);

  const { navigateToSampleDetail } = useSamplesGridNavigationAction();
  const handleRowOpen = useCallback(
    (row: SampleRow) => {
      navigateToSampleDetail(row.logFile, row.sampleId, row.epoch);
    },
    [navigateToSampleDetail]
  );

  // Reflect the rendered row set into store-backed displayed-samples state
  // (drives footer count + cross-tab navigation). Filtering is deferred, so
  // every flattened row is "displayed".
  useEffect(() => {
    const displayed = sampleRows.map((row) => ({
      logFile: row.logFile,
      sampleId: row.sampleId,
      epoch: row.epoch,
    }));
    setFilteredSampleCount(displayed.length);
    setDisplayedSamples(displayed);
  }, [sampleRows, setFilteredSampleCount, setDisplayedSamples]);

  useEffect(() => {
    clearSelectedSample();
  }, [samplesPath, clearSelectedSample]);

  const getRowId = useCallback(
    (row: SampleRow) => sampleRowId(row.logFile, row.sampleId, row.epoch),
    []
  );

  const selectedRowId = selectedSampleHandle
    ? sampleRowId(
        selectedSampleHandle.logFile,
        selectedSampleHandle.id,
        selectedSampleHandle.epoch
      )
    : undefined;

  // Keyboard/click selection moves flow to the selection's owner (zustand),
  // which feeds back through selectedRowId — the grid never shadows it.
  const handleRowSelect = useCallback(
    (row: SampleRow) => selectSample(row.sampleId, row.epoch, row.logFile),
    []
  );

  const isEmptyAndLoading = sampleRows.length === 0 && listing.busy;

  return (
    <div className={clsx(styles.panel)}>
      <ApplicationNavbar currentPath={samplesPath} fnNavigationUrl={samplesUrl}>
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
            }}
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

        <ViewSegmentedControl selectedSegment="samples" />
        {flowData && <FlowButton />}
      </ApplicationNavbar>

      <ColumnSelectorPopover
        showing={showColumnSelector}
        setShowing={setShowColumnSelector}
        columns={pickerColumns}
        visibility={visibilityForGrid}
        onVisibilityChange={setColumnVisibility}
        positionEl={columnButtonEl}
        scoresHeading="Scores"
      />

      <ActivityBar animating={listing.busy} />
      <div className={clsx(styles.list, "text-size-smaller")}>
        <SamplesGrid
          rowData={sampleRows}
          columnDefs={allColumns}
          columnVisibility={visibilityForGrid}
          defaultSorting={kSamplesPanelDefaultSorting}
          getRowId={getRowId}
          selectedRowId={selectedRowId}
          onRowSelect={handleRowSelect}
          onRowOpen={handleRowOpen}
          loading={isEmptyAndLoading}
        />
      </div>

      <LogListFooter
        itemCount={filteredSamplesCount ?? 0}
        itemCountLabel={filteredSamplesCount === 1 ? "sample" : "samples"}
        progressText={
          listing.busy
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
