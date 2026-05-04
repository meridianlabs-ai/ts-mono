import type { ColDef, GridApi } from "ag-grid-community";
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
import {
  astToFilterModel,
  FilterModel,
} from "../../samples/sample-tools/astToFilterModel.ts";
import { parseFilter } from "../../samples/sample-tools/filterAst.ts";
import { filterModelToText } from "../../samples/sample-tools/filterModelToText.ts";
import { buildSampleFilterRegistry } from "../../samples/sample-tools/filterRegistry.ts";
import { ColumnSelectorPopover } from "../../shared/ColumnSelectorPopover.tsx";
import { getFieldKey } from "../../shared/gridUtils.ts";
import {
  buildSampleColumns,
  perScorerFieldKey,
} from "../../shared/samples-grid/columns.tsx";
import { SampleRow } from "../../shared/samples-grid/types.ts";
import {
  clearFiltersForHiddenColumns,
  useSampleGridState,
} from "../../shared/samples-grid/useSampleGridState.ts";

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
    // `scrollRef`, `columnButtonRef`, and `setShowColumnSelector` are
    // intentionally omitted — refs and React state setters have stable
    // identity across renders, so including them only churns the memo
    // without changing behavior. If `componentProps` ever gains a
    // non-stable value, add it to the deps list.
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
      // Mirror the col.hide for epoch so the seeded visibility matches
      // and we don't get a flash of "visible → hidden" once seeding
      // persists `epoch: true` into the store.
      if (id === "epoch") return epochs > 1;
      if (id === "limit") return !!shape?.limitSize;
      if (id === "retries") return !!shape?.retriesSize;
      if (id === "error") return !!shape?.errorSize;
      if (id === "sampleUuid") return false;
      return true;
    },
    [shape, epochs]
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
  const selectedScoreFields = useMemo(
    () => new Set(selectedScores.map(perScorerFieldKey)),
    [selectedScores]
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
      const id = perScorerFieldKey(label);
      v[id] = selectedScoreFields.has(id);
    }
    return v;
  }, [allColumns, columnVisibility, scores, selectedScoreFields]);

  const allScoreFields = useMemo(
    () => new Set(scores.map(perScorerFieldKey)),
    [scores]
  );

  // When the user toggles columns in the popover, split score-column
  // changes back into `selectedScores` and persist the rest as normal
  // column visibility.
  const handleVisibilityChange = useCallback(
    (next: Record<string, boolean>) => {
      // Clear filters for ANY column being hidden — including score
      // columns, whose visibility lives in `selectedScores` rather than
      // the persisted columnVisibility map. (The setColumnVisibility
      // wrapper below would otherwise only see the non-score subset.)
      const api = sampleListHandle.current?.api;
      if (api) clearFiltersForHiddenColumns(api, next);

      const newSelected = scores.filter(
        (label) => next[perScorerFieldKey(label)] !== false
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

  // Bidirectional filter sync (phases 2b + 2c). The toolbar text filter
  // and the column `FilterModel` describe the same logical narrowing;
  // this block keeps them in lock-step:
  //
  //   columns →  text:  on every grid filter change, synthesize a filtrex
  //                     expression from the FilterModel and push to text.
  //   text    → columns: when the text changes (and is round-trippable),
  //                     parse it into a FilterModel and apply it to the
  //                     grid. Non-round-trippable text clears the column
  //                     filters so they don't double-narrow.
  //
  // The feedback loop is broken at each boundary by comparing the value
  // we'd write against the value already there — the two sides are the
  // canonical state, no separate trackers needed.
  const filterRegistry = useMemo(
    () => buildSampleFilterRegistry(samplesDescriptor?.evalDescriptor),
    [samplesDescriptor]
  );
  const setFilter = useStore((state) => state.logActions.setFilter);
  const currentFilter = useStore((state) => state.log.filter);
  const currentFilterRef = useRef(currentFilter);
  currentFilterRef.current = currentFilter;

  /** Parse `text` and project it to the FilterModel the column UI
   *  should be holding — `{}` for empty or non-round-trippable text. */
  const filterModelFromText = useCallback(
    (text: string): FilterModel => {
      const { ast } = parseFilter(text);
      return ast ? (astToFilterModel(ast, filterRegistry) ?? {}) : {};
    },
    [filterRegistry]
  );

  const handleFilterChanged = useCallback(
    (api: GridApi<SampleRow>) => {
      const model = api.getFilterModel() ?? {};
      setFilteredFields(Object.keys(model));

      // If `currentFilter` already projects to the model we're seeing,
      // the two sides are aligned — no echo needed. This covers both the
      // round-trippable case (`tokens > 50` ↔ `{tokens: gt 50}`) and the
      // expression-only case where text stays put while columns are `{}`.
      const fromText = filterModelFromText(currentFilterRef.current);
      if (JSON.stringify(fromText) === JSON.stringify(model)) return;

      const synthesized = filterModelToText(model, filterRegistry);
      // Columns are filtered but none are representable — leave text alone.
      if (synthesized === null) return;
      if (synthesized !== currentFilterRef.current) setFilter(synthesized);
    },
    [filterRegistry, filterModelFromText, setFilter]
  );

  useEffect(() => {
    const api = sampleListHandle.current?.api;
    if (!api) return;
    const desired = filterModelFromText(currentFilter);
    const current: FilterModel = (api.getFilterModel() ?? {}) as FilterModel;
    // Preserve current model entries that the synthesizer would have
    // skipped — they live only in the column UI and must not be wiped
    // by a text-driven update. Entries the user can express in text
    // (round-trippable ones) are governed by `desired`.
    const merged: FilterModel = { ...desired };
    for (const [colId, filter] of Object.entries(current)) {
      const isRepresentable =
        filterModelToText({ [colId]: filter }, filterRegistry) !== null;
      if (!isRepresentable && !(colId in desired)) {
        merged[colId] = filter;
      }
    }
    if (JSON.stringify(current) === JSON.stringify(merged)) return;
    api.setFilterModel(merged);
  }, [currentFilter, filterModelFromText, filterRegistry]);

  // When the toolbar text is a non-round-trippable expression, hide the
  // column-header filter buttons. Using one would overwrite the typed
  // text with a much narrower synthesized version. Empty text and
  // round-trippable text both leave the headers usable.
  const columnFilteringAllowed = useMemo(() => {
    if (!currentFilter.trim()) return true;
    const { ast } = parseFilter(currentFilter);
    if (!ast) return false;
    return astToFilterModel(ast, filterRegistry) !== null;
  }, [currentFilter, filterRegistry]);

  const gridColumns = useMemo(
    () =>
      columnFilteringAllowed
        ? allColumns
        : allColumns.map((col) => ({
            ...col,
            suppressHeaderFilterButton: true,
          })),
    [allColumns, columnFilteringAllowed]
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
          columns={gridColumns}
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
