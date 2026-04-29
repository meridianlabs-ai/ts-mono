import type { ColDef } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import {
  FC,
  Fragment,
  RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { inputString } from "@tsmono/inspect-common/utils";
import { NoContentsPanel, ToolButton } from "@tsmono/react/components";

import { EvalLogStatus } from "../../../@types/extraInspect.ts";
import { InlineSampleDisplay } from "../../../app/samples/InlineSampleDisplay.tsx";
import { SampleList } from "../../../app/samples/list/SampleList.tsx";
import {
  SampleTools,
  ScoreFilterTools,
} from "../../../app/samples/SamplesTools.tsx";
import { kLogViewSamplesTabId } from "../../../constants.ts";
import {
  useFilteredSamples,
  useSampleDescriptor,
  useScores,
  useSelectedScores,
  useTotalSampleCount,
} from "../../../state/hooks.ts";
import { useStore } from "../../../state/store.ts";
import { ApplicationIcons } from "../../appearance/icons.ts";
import { NavbarButton } from "../../navbar/NavbarButton.tsx";
import { ColumnSelectorPopover } from "../../shared/ColumnSelectorPopover.tsx";
import { getFieldKey } from "../../shared/gridUtils.ts";
import { buildSampleColumns } from "../../shared/samples-grid/columns.tsx";
import { SampleRow } from "../../shared/samples-grid/types.ts";
import { useSampleGridState } from "../../shared/samples-grid/useSampleGridState.ts";

import { RunningNoSamples } from "./RunningNoSamples.tsx";

interface SamplesTabExtraProps {
  showColumnSelector: boolean;
  setShowColumnSelector: (showing: boolean) => void;
  columnButtonRef: RefObject<HTMLButtonElement | null>;
}

// Individual hook for Samples tab
export const useSamplesTabConfig = (
  evalStatus: EvalLogStatus | undefined,
  refreshLog: () => void
) => {
  const totalSampleCount = useTotalSampleCount();
  const samplesDescriptor = useSampleDescriptor();
  const streamSamples = useStore((state) => state.capabilities.streamSamples);

  // Single ref exposed to the parent so cross-tab UI (title-view
  // collapse-on-scroll) can listen to scrolling inside this tab. Only one of
  // `InlineSampleDisplay` or `SampleList` is mounted at a time, so they
  // share this ref.
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Column-selector state lives here so the tools toolbar can host the
  // trigger button while the popover is rendered inside SamplesTab.
  const [showColumnSelector, setShowColumnSelector] = useState(false);
  const columnButtonRef = useRef<HTMLButtonElement | null>(null);
  const handleToggleColumnSelector = useCallback(() => {
    setShowColumnSelector((p) => !p);
  }, []);

  return useMemo(() => {
    const samplesAvailable =
      samplesDescriptor !== undefined && totalSampleCount > 1;
    return {
      id: kLogViewSamplesTabId,
      scrollable: false,
      scrollRef,
      label: totalSampleCount > 1 ? "Samples" : "Sample",
      component: SamplesTab,
      componentProps: {
        running: evalStatus === "started",
        scrollRef,
        showColumnSelector,
        setShowColumnSelector,
        columnButtonRef,
      },
      tools: () =>
        !samplesDescriptor
          ? undefined
          : totalSampleCount === 1
            ? [<ScoreFilterTools key="sample-score-tool" />]
            : [
                <SampleTools key="sample-tools" />,
                evalStatus === "started" && !streamSamples && (
                  <ToolButton
                    key="refresh"
                    label="Refresh"
                    icon={ApplicationIcons.refresh}
                    onClick={refreshLog}
                  />
                ),
                samplesAvailable && (
                  <NavbarButton
                    key="choose-columns"
                    ref={columnButtonRef}
                    label="Columns"
                    icon={ApplicationIcons.columns}
                    dropdown
                    subtle
                    onClick={handleToggleColumnSelector}
                  />
                ),
              ],
    };
  }, [
    evalStatus,
    refreshLog,
    samplesDescriptor,
    streamSamples,
    totalSampleCount,
    showColumnSelector,
    handleToggleColumnSelector,
  ]);
};

interface SamplesTabProps extends SamplesTabExtraProps {
  running: boolean;
  scrollRef?: RefObject<HTMLDivElement | null>;
}

export const SamplesTab: FC<SamplesTabProps> = ({
  running,
  scrollRef,
  showColumnSelector,
  setShowColumnSelector,
  columnButtonRef,
}) => {
  const sampleSummaries = useFilteredSamples();
  const selectedLogDetails = useStore((state) => state.log.selectedLogDetails);
  const selectedLogFile = useStore((state) => state.logs.selectedLogFile);

  const evalSampleCount = useMemo(() => {
    const limit = selectedLogDetails?.eval.config.limit;
    const limitCount =
      limit === null || limit === undefined
        ? undefined
        : typeof limit === "number"
          ? limit
          : (limit[1] as number) - (limit[0] as number);
    return (
      (limitCount || selectedLogDetails?.eval.dataset.samples || 0) *
      (selectedLogDetails?.eval.config.epochs || 0)
    );
  }, [
    selectedLogDetails?.eval.config.epochs,
    selectedLogDetails?.eval.config.limit,
    selectedLogDetails?.eval.dataset.samples,
  ]);

  const totalSampleCount = useTotalSampleCount();

  const samplesDescriptor = useSampleDescriptor();
  const selectedScores = useSelectedScores();
  const scores = useScores();
  const setSelectedScores = useStore(
    (state) => state.logActions.setSelectedScores
  );
  const epochs = selectedLogDetails?.eval.config?.epochs || 1;

  const selectSample = useStore((state) => state.logActions.selectSample);
  const sampleStatus = useStore((state) => state.sample.sampleStatus);

  const sampleListHandle = useRef<AgGridReact<SampleRow> | null>(null);

  // Build the superset of available columns once. Score columns are
  // emitted for every available score; visibility (which scorers are
  // currently selected) is applied via the column-visibility map below.
  const allColumns = useMemo(
    () =>
      buildSampleColumns({
        viewMode: "list",
        multiLog: false,
        descriptor: samplesDescriptor,
        scores,
        epochs,
      }),
    [samplesDescriptor, scores, epochs]
  );

  // Default visibility for unseeded columns. Core text columns
  // (input/target/answer) are visible by default — the user can hide
  // them if not useful. limit/retries/error default off and only
  // auto-promote to visible when data is present, mirroring the
  // SamplesPanel behavior.
  const shape = samplesDescriptor?.messageShape;
  const defaultsForUnseededColumns = useCallback(
    (col: ColDef<SampleRow>) => {
      const id = col.colId;
      if (id === "limit") return !!shape?.limitSize;
      if (id === "retries") return !!shape?.retriesSize;
      if (id === "error") return !!shape?.errorSize;
      return true;
    },
    [shape]
  );

  const { columnVisibility, setColumnVisibility, gridState, setGridState } =
    useSampleGridState<SampleRow>("logViewSamples", allColumns, {
      defaultsForUnseededColumns,
      gridRef: sampleListHandle,
    });

  // Score column visibility comes from `selectedScores` (so toggling a
  // scorer in the column popover stays consistent with the rest of the
  // app that reads `selectedScores`). Non-score columns come from the
  // persisted `columnVisibility` map.
  const scoreFieldFor = useCallback(
    (label: { scorer: string; name: string }) =>
      `score__${label.scorer}__${label.name}`,
    []
  );
  const selectedScoreFields = useMemo(
    () => new Set(selectedScores.map(scoreFieldFor)),
    [selectedScores, scoreFieldFor]
  );

  // Visibility map applied via the grid's api so column defs stay
  // stable across visibility/score-selection changes — necessary for
  // user-driven width and reorder to persist.
  const visibilityForGrid = useMemo<Record<string, boolean>>(() => {
    const v: Record<string, boolean> = {};
    for (const col of allColumns) {
      const key = getFieldKey(col);
      const seeded = columnVisibility[key];
      v[key] = seeded === undefined ? !col.hide : seeded;
    }
    for (const label of scores) {
      v[scoreFieldFor(label)] = selectedScoreFields.has(scoreFieldFor(label));
    }
    return v;
  }, [
    allColumns,
    columnVisibility,
    scores,
    scoreFieldFor,
    selectedScoreFields,
  ]);

  const allScoreFields = useMemo(
    () => new Set(scores.map(scoreFieldFor)),
    [scores, scoreFieldFor]
  );

  // When the user toggles columns in the popover, split score-column
  // changes back into `selectedScores` and persist the rest as normal
  // column visibility.
  const handleVisibilityChange = useCallback(
    (next: Record<string, boolean>) => {
      const newSelected = scores.filter(
        (label) => next[scoreFieldFor(label)] !== false
      );
      const sameAsBefore =
        newSelected.length === selectedScores.length &&
        newSelected.every((s, i) => {
          const cur = selectedScores[i];
          return cur && cur.scorer === s.scorer && cur.name === s.name;
        });
      if (!sameAsBefore) setSelectedScores(newSelected);

      const nonScoreVisibility: Record<string, boolean> = {};
      for (const [key, value] of Object.entries(next)) {
        if (!allScoreFields.has(key)) nonScoreVisibility[key] = value;
      }
      setColumnVisibility(nonScoreVisibility);
    },
    [
      scores,
      scoreFieldFor,
      selectedScores,
      setSelectedScores,
      setColumnVisibility,
      allScoreFields,
    ]
  );

  // Build SampleRow items from filtered sample summaries.
  const items: SampleRow[] = useMemo(() => {
    if (!samplesDescriptor || !selectedLogFile) return [];
    return sampleSummaries.map((sample): SampleRow => {
      const tokens = sample.model_usage
        ? Object.values(sample.model_usage).reduce(
            (sum, u) => sum + (u.total_tokens ?? 0),
            0
          )
        : undefined;
      return {
        logFile: selectedLogFile,
        sampleId: sample.id,
        epoch: sample.epoch,
        data: sample,
        answer:
          samplesDescriptor.selectedScorerDescriptor(sample)?.answer() ?? "",
        completed: sample.completed ?? true,
        input: inputString(sample.input).join(" "),
        target: Array.isArray(sample.target)
          ? sample.target.join(", ")
          : (sample.target as string | undefined),
        error: sample.error,
        limit: sample.limit,
        retries: sample.retries,
        tokens,
        duration: sample.total_time ?? undefined,
      };
    });
  }, [sampleSummaries, samplesDescriptor, selectedLogFile]);

  useEffect(() => {
    if (sampleSummaries.length === 1 && selectedLogFile) {
      const sample = sampleSummaries[0];
      selectSample(sample.id, sample.epoch, selectedLogFile);
    }
  }, [sampleSummaries, selectSample, selectedLogFile]);

  // Tracked here so the column selector can mark filtered columns.
  // Updated via the grid's onFilterChanged callback.
  const [filteredFields, setFilteredFields] = useState<string[]>([]);
  const handleFilterChanged = useCallback(
    (api: { getFilterModel: () => Record<string, unknown> | null }) => {
      setFilteredFields(Object.keys(api.getFilterModel() ?? {}));
    },
    []
  );

  if (totalSampleCount === 0) {
    if (running) {
      return <RunningNoSamples />;
    } else {
      return <NoContentsPanel text="No samples" />;
    }
  }

  const inlineDisplay = samplesDescriptor && totalSampleCount === 1;
  const listDisplay = samplesDescriptor && totalSampleCount > 1;

  return (
    <Fragment>
      {inlineDisplay ? (
        <InlineSampleDisplay
          showActivity={
            sampleStatus === "loading" || sampleStatus === "streaming"
          }
          scrollRef={scrollRef}
        />
      ) : null}
      {listDisplay ? (
        <SampleList
          listHandle={sampleListHandle}
          items={items}
          columns={allColumns}
          columnVisibility={visibilityForGrid}
          earlyStopping={selectedLogDetails?.results?.early_stopping}
          totalItemCount={evalSampleCount}
          running={running}
          scrollRef={scrollRef}
          gridState={gridState}
          onGridStateChange={setGridState}
          onFilterChanged={handleFilterChanged}
        />
      ) : null}
      {listDisplay ? (
        <ColumnSelectorPopover
          showing={showColumnSelector}
          setShowing={setShowColumnSelector}
          columns={allColumns}
          visibility={visibilityForGrid}
          onVisibilityChange={handleVisibilityChange}
          positionEl={columnButtonRef.current}
          filteredFields={filteredFields}
          scoresHeading="Scores"
        />
      ) : null}
    </Fragment>
  );
};
