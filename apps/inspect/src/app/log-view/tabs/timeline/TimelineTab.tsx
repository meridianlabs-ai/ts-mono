import clsx from "clsx";
import {
  FC,
  MouseEvent as ReactMouseEvent,
  RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  ConfigUpdate,
  EarlyStoppingSummary,
  EvalSpec,
  EvalStats,
  LogUpdate,
} from "@tsmono/inspect-common/types";
import { isoToEpoch } from "@tsmono/inspect-common/utils";
import {
  adaptiveMaxFromConfig,
  buildConfigsByModel,
  buildConnectionLanes,
  poolRetunes,
} from "@tsmono/inspect-components/usage";
import { useProperty } from "@tsmono/react/hooks";

import { EvalLogStatus } from "../../../../@types/extraInspect";
import type { SampleSummary } from "../../../../client/api/types";
import { kLogViewTimelineTabId } from "../../../../constants";
import {
  useEvalDescriptor,
  useSelectedSampleSummaries,
} from "../../../../state/hooks";
import { useSampleNavigationActions } from "../../../routing/sampleNavigation";
import { openInNewTab } from "../../../shared/openInNewTab";
import {
  kTimelineBag,
  timelineBandId,
  useTimelineBandsKey,
  useTimelineLogKey,
} from "../../useShowTimeline";

import { HistoryList } from "./HistoryList";
import { TimelineChart } from "./TimelineChart";
import {
  activeSamplesSeries,
  configMarkers,
  densestTerminationBin,
  dotLadderStep,
  guideSegments,
  HistoryCategory,
  historyRows,
  kStatusColor,
  kTallRailHeight,
  logMarkers,
  markerKey,
  rowHaystack,
  terminations,
  withConfigOrdinals,
} from "./timelineData";
import styles from "./TimelineTab.module.css";

export const useTimelineTab = (
  evalSpec: EvalSpec | undefined,
  evalStats: EvalStats | undefined,
  evalStatus?: EvalLogStatus,
  configUpdates?: ConfigUpdate[] | null,
  logUpdates?: LogUpdate[] | null,
  earlyStopping?: EarlyStoppingSummary | null
) => {
  // Shared with the history list, which virtualizes against the tab's
  // scroll container (the whole tab scrolls — the list has no scrollbar).
  const scrollRef = useRef<HTMLDivElement | null>(null);
  return useMemo(() => {
    return {
      id: kLogViewTimelineTabId,
      label: "Timeline",
      scrollable: true,
      scrollRef,
      component: TimelineTab,
      componentProps: {
        evalSpec,
        evalStats,
        evalStatus,
        configUpdates,
        logUpdates,
        earlyStopping,
        scrollRef,
      },
    };
  }, [
    evalSpec,
    evalStats,
    evalStatus,
    configUpdates,
    logUpdates,
    earlyStopping,
  ]);
};

interface TimelineTabProps {
  evalSpec?: EvalSpec;
  evalStats?: EvalStats;
  evalStatus?: EvalLogStatus;
  configUpdates?: ConfigUpdate[] | null;
  logUpdates?: LogUpdate[] | null;
  earlyStopping?: EarlyStoppingSummary | null;
  scrollRef: RefObject<HTMLDivElement | null>;
}

const kLimitKnobs: [string, string][] = [
  ["message", "message_limit"],
  ["time", "time_limit"],
  ["token", "token_limit"],
  ["working", "working_limit"],
  ["turn", "turn_limit"],
];

const limitKnob = (limit: string): string | undefined =>
  kLimitKnobs.find(([kind]) => limit.includes(kind))?.[1];

// Stable empty arrays — a fresh identity would re-render every row.
const kNoKeys: string[] = [];
const kNoCategories: HistoryCategory[] = [];

// Durable UI state (filters, search, sort, selection) lives in the store
// keyed per log — the tab unmounts on tab switches, so useState would drop
// it. Keying the body per log resets the remaining transient state (hover
// links, chart popovers) when the log in view changes.
export const TimelineTab: FC<TimelineTabProps> = (props) => {
  const logKey = useTimelineLogKey("tab");
  return <TimelineTabBody key={logKey} {...props} />;
};

const TimelineTabBody: FC<TimelineTabProps> = ({
  evalSpec,
  evalStats,
  evalStatus,
  configUpdates,
  logUpdates,
  earlyStopping,
  scrollRef,
}) => {
  const sampleData = useSelectedSampleSummaries().data;
  const samples = useMemo(() => sampleData ?? [], [sampleData]);
  const evalDescriptor = useEvalDescriptor();
  const { showSample, getSampleUrl } = useSampleNavigationActions();

  const runStart = isoToEpoch(evalStats?.started_at);
  const runEnd = isoToEpoch(evalStats?.completed_at);

  // Config retunes and tag/metadata edits share the ◆ marker rail; config
  // markers carry chronological ordinals (1..N) that never renumber.
  const markers = useMemo(
    () =>
      withConfigOrdinals(
        [
          ...configMarkers(configUpdates, runEnd),
          ...logMarkers(logUpdates, runEnd),
        ].sort((a, b) => a.time - b.time)
      ),
    [configUpdates, logUpdates, runEnd]
  );

  // markerKey → ordinal: the History rows render the same shared token.
  const ordinals = useMemo(() => {
    const map = new Map<string, number>();
    for (const marker of markers) {
      if (marker.kind === "config" && marker.ordinal !== undefined) {
        map.set(markerKey(marker.kind, marker.index), marker.ordinal);
      }
    }
    return map;
  }, [markers]);

  const dots = useMemo(() => terminations(samples), [samples]);

  // Window: the run bounds, widened to cover any timestamped signal.
  const window = useMemo(() => {
    // Running min/max — spreading a per-sample array into Math.min/max
    // overflows the engine argument limit on very large logs.
    let start = Infinity;
    let end = -Infinity;
    const cover = (t: number) => {
      if (t < start) start = t;
      if (t > end) end = t;
    };
    if (runStart !== undefined) cover(runStart);
    if (runEnd !== undefined) cover(runEnd);
    for (const dot of dots) cover(dot.time);
    // Sample starts too: a live eval has no stats yet, so the window would
    // otherwise open after in-flight samples began and the active-samples
    // series would double back on itself (its points sort by time).
    for (const sample of samples) {
      const started = isoToEpoch(sample.started_at);
      if (started !== undefined) cover(started);
    }
    // Inherited (pre-run) updates keep their original timestamps, which can
    // predate the run by hours — covering them would compress the actual
    // run into a sliver of the axis (the chart clamps them to the left edge
    // instead).
    for (const marker of markers) {
      if (!marker.postRun && !marker.preRun) cover(marker.time);
    }
    for (const event of evalStats?.connection_limit_history ?? []) {
      cover(event.timestamp);
    }
    return end > start ? { start, end } : undefined;
  }, [
    runStart,
    runEnd,
    dots,
    samples,
    markers,
    evalStats?.connection_limit_history,
  ]);

  const activeSeries = useMemo(
    () =>
      window
        ? activeSamplesSeries(samples, window, evalStatus === "started")
        : [],
    [samples, window, evalStatus]
  );

  const configsByModel = useMemo(
    () => buildConfigsByModel(evalSpec),
    [evalSpec]
  );
  const lanes = useMemo(
    () =>
      buildConnectionLanes(
        evalStats?.connection_limit_history,
        window,
        (model) => adaptiveMaxFromConfig(configsByModel?.[model])
      ),
    [evalStats?.connection_limit_history, window, configsByModel]
  );
  const retunes = useMemo(
    () => poolRetunes(configUpdates, evalSpec?.model),
    [configUpdates, evalSpec?.model]
  );

  const samplesGuide = useMemo(
    () =>
      window
        ? guideSegments(
            evalSpec?.config.max_samples,
            "max_samples",
            markers,
            window
          )
        : [],
    [evalSpec?.config.max_samples, markers, window]
  );

  // ── band picker (state keyed per log) ────────────────────────────────

  const bandsKey = useTimelineBandsKey();
  const [bandOverrides, setBandOverrides] = useProperty<
    Record<string, boolean>
  >(kTimelineBag, bandsKey, { defaultValue: {} });

  const laneModels = Object.keys(lanes).sort();
  const bandOn = useCallback(
    (id: string, fallback: boolean): boolean => bandOverrides[id] ?? fallback,
    [bandOverrides]
  );
  const toggleBand = (id: string, fallback: boolean) => {
    setBandOverrides({
      ...bandOverrides,
      [id]: !bandOn(id, fallback),
    });
  };

  // Pathology guard (design canvas 34a): a degenerate run would render a
  // screen-height wall of dots — keep the honest height but collapse the
  // rail by default; the chip opts into the full wall.
  const tallRail = useMemo(() => {
    if (!window || dots.length === 0) return false;
    const maxBin = densestTerminationBin(dots, window);
    return maxBin * dotLadderStep(maxBin).pitch > kTallRailHeight;
  }, [dots, window]);

  const showActiveSamples =
    activeSeries.length > 0 && bandOn(timelineBandId("active"), true);
  const showTerminations =
    dots.length > 0 && bandOn(timelineBandId("terminations"), !tallRail);
  // A model's band auto-lights when that model was retuned or rate-limited.
  const connectionsDefault = (model: string): boolean =>
    (lanes[model]?.rateLimitCount ?? 0) > 0 ||
    (retunes[model]?.length ?? 0) > 0;
  const enabledModels = laneModels.filter((model) =>
    bandOn(timelineBandId("connections", model), connectionsDefault(model))
  );

  // ── history rows + filters ───────────────────────────────────────────

  const rows = useMemo(
    () =>
      historyRows({
        status: evalStatus,
        stats: evalStats,
        launchConfig: evalSpec?.config,
        model: evalSpec?.model,
        configUpdates,
        logUpdates,
        earlyStopping,
        samples,
      }),
    [
      evalStatus,
      evalStats,
      evalSpec?.config,
      evalSpec?.model,
      configUpdates,
      logUpdates,
      earlyStopping,
      samples,
    ]
  );

  // Additive filter pills: empty selection = All (a reset, not a seventh
  // filter) — Config + Limits together is the "did lifting it help?" read.
  // Stored as an array (a Set wouldn't survive the store's JSON persistence).
  const [categoryList, setCategoryList] = useProperty<HistoryCategory[]>(
    kTimelineBag,
    useTimelineLogKey("filters"),
    { defaultValue: kNoCategories }
  );
  const selectedCategories = useMemo(
    () => new Set(categoryList),
    [categoryList]
  );
  const toggleCategory = (category: HistoryCategory | "all") => {
    if (category === "all") {
      setCategoryList([]);
      return;
    }
    setCategoryList(
      categoryList.includes(category)
        ? categoryList.filter((existing) => existing !== category)
        : [...categoryList, category]
    );
  };

  const [search, setSearch] = useProperty<string>(
    kTimelineBag,
    useTimelineLogKey("search"),
    { defaultValue: "" }
  );
  // Time is the one sortable column — descending by default on a running
  // log so new events land at the top (canvas 37b). The default is captured
  // into the store on first view of the log: a run completing mid-session
  // must not flip the list under the user.
  const [timeSort, setTimeSort] = useProperty<"asc" | "desc">(
    kTimelineBag,
    useTimelineLogKey("sort")
  );
  const timeDescending = timeSort
    ? timeSort === "desc"
    : evalStatus === "started";
  useEffect(() => {
    if (timeSort === undefined) {
      setTimeSort(evalStatus === "started" ? "desc" : "asc");
    }
  }, [timeSort, setTimeSort, evalStatus]);

  const [selectedEventKey, setSelectedEventKey] = useProperty<string | null>(
    kTimelineBag,
    useTimelineLogKey("selected"),
    { defaultValue: null }
  );
  // Bidirectional marker ↔ row hover link (canvas 36a).
  const [hoverLink, setHoverLink] = useState<{
    source: "marker" | "row";
    keys: string[];
  } | null>(null);

  // Click marker → scroll to its row, clearing any filter that would hide
  // it: a category filter widens to include the row, and a non-matching
  // search is dropped (otherwise the selection is invisible in the list).
  const selectMarker = useCallback(
    (key: string | null) => {
      setSelectedEventKey(key);
      if (key !== null) {
        const category: HistoryCategory = key.startsWith("config:")
          ? "config"
          : "tags";
        if (categoryList.length > 0 && !categoryList.includes(category)) {
          setCategoryList([...categoryList, category]);
        }
        const query = search.trim().toLowerCase();
        if (query !== "") {
          const row = rows.find(
            (r) =>
              (r.kind === "config" && markerKey("config", r.index) === key) ||
              (r.kind === "logUpdate" && markerKey("log", r.index) === key)
          );
          if (row && !rowHaystack(row).toLowerCase().includes(query)) {
            setSearch("");
          }
        }
      }
    },
    [
      rows,
      search,
      setSearch,
      categoryList,
      setCategoryList,
      setSelectedEventKey,
    ]
  );

  const limitCrossReference = useCallback(
    (sample: SampleSummary): string | undefined => {
      if (!sample.limit) return undefined;
      const knob = limitKnob(sample.limit);
      if (!knob) return undefined;
      const completed = isoToEpoch(sample.completed_at);
      if (completed === undefined) return undefined;
      for (const marker of markers) {
        // Post-run amendments changed nothing for samples that ran.
        if (marker.kind !== "config" || marker.postRun) continue;
        if (marker.time <= completed) continue;
        for (const change of marker.update.changes) {
          if (change.config !== "eval" || change.name !== knob) continue;
          const when = new Date(marker.time * 1000).toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          });
          if (!change.cleared && change.value === null) {
            return `${knob} was lifted at ${when} — samples after that no longer hit this limit`;
          }
          return `${knob} was changed at ${when} — samples after that ran under a different limit`;
        }
      }
      return undefined;
    },
    [markers]
  );

  // Plain click navigates in place; cmd/ctrl/shift click opens a new tab.
  const openSample = useCallback(
    (id: string | number, epoch: number, event?: ReactMouseEvent) => {
      if (event && (event.metaKey || event.ctrlKey || event.shiftKey)) {
        const url = getSampleUrl(id, epoch);
        if (url) {
          openInNewTab(url);
          return;
        }
      }
      showSample(id, epoch);
    },
    [showSample, getSampleUrl]
  );

  const showRateLimitLegend = enabledModels.some(
    (model) => (lanes[model]?.rateLimitCount ?? 0) > 0
  );

  return (
    <div style={{ width: "100%" }}>
      <div className={styles.container}>
        {window && (
          <div className={styles.pickerRow}>
            <span className={styles.caption}>Timelines</span>
            {activeSeries.length > 0 && (
              <BandChip
                label="Active samples"
                on={showActiveSamples}
                onToggle={() => toggleBand(timelineBandId("active"), true)}
              />
            )}
            {dots.length > 0 && (
              <BandChip
                label="Terminations"
                note={tallRail ? "tall rail" : undefined}
                title={
                  tallRail
                    ? "The densest column makes this rail taller than a " +
                      "screen — toggle on to show the full wall of dots."
                    : undefined
                }
                on={showTerminations}
                onToggle={() =>
                  toggleBand(timelineBandId("terminations"), !tallRail)
                }
              />
            )}
            {laneModels.map((model) => (
              <BandChip
                key={model}
                label={`Connections · ${model}`}
                on={enabledModels.includes(model)}
                onToggle={() =>
                  toggleBand(
                    timelineBandId("connections", model),
                    connectionsDefault(model)
                  )
                }
              />
            ))}
            {/* Derived legend: visible bands only. Marks whose hue a filter
                pill already carries (config ◆, tag ◆, error, limit) are not
                repeated here — the pill row doubles as the rail's legend. */}
            <span className={styles.legend}>
              {showTerminations && (
                <>
                  {dots.some((dot) => dot.status === "completed") && (
                    <span className={styles.legendItem}>
                      <span
                        className={styles.legendDot}
                        style={{ background: kStatusColor.completed }}
                      />
                      completed
                    </span>
                  )}
                  {dots.some((dot) => dot.status === "cancelled") && (
                    <span className={styles.legendItem}>
                      <span
                        className={styles.legendDot}
                        style={{ background: kStatusColor.cancelled }}
                      />
                      cancelled
                    </span>
                  )}
                  {dots.some((dot) => dot.status === "started") && (
                    <span className={styles.legendItem}>
                      <span
                        className={styles.legendDot}
                        style={{
                          background: "transparent",
                          border: `1.5px solid ${kStatusColor.started}`,
                        }}
                      />
                      started
                    </span>
                  )}
                </>
              )}
              {showRateLimitLegend && (
                <span className={styles.legendItem}>
                  <span className={styles.legendRateLimit} />
                  rate limit
                </span>
              )}
            </span>
          </div>
        )}
        {window && (
          <TimelineChart
            window={window}
            running={evalStatus === "started"}
            showActiveSamples={showActiveSamples}
            showTerminations={showTerminations}
            connectionModels={enabledModels}
            activeSeries={activeSeries}
            samplesGuide={samplesGuide}
            terminationDots={dots}
            lanes={lanes}
            retunes={retunes}
            markers={markers}
            selectedMarker={selectedEventKey}
            onSelectMarker={selectMarker}
            hoveredRowKey={
              hoverLink?.source === "row" ? (hoverLink.keys[0] ?? null) : null
            }
            onHoverMarker={(keys) =>
              setHoverLink(
                keys && keys.length > 0 ? { source: "marker", keys } : null
              )
            }
            evalDescriptor={evalDescriptor}
            limitCrossReference={limitCrossReference}
            onOpenSample={openSample}
          />
        )}
        <HistoryList
          rows={rows}
          ordinals={ordinals}
          scrollRef={scrollRef}
          selectedCategories={selectedCategories}
          onToggleCategory={toggleCategory}
          search={search}
          onSearchChange={setSearch}
          timeDescending={timeDescending}
          onToggleTimeSort={() => setTimeSort(timeDescending ? "asc" : "desc")}
          selectedEventKey={selectedEventKey}
          onSelectEvent={setSelectedEventKey}
          washKeys={hoverLink?.source === "marker" ? hoverLink.keys : kNoKeys}
          onHoverRow={(key) =>
            setHoverLink(key !== null ? { source: "row", keys: [key] } : null)
          }
          onOpenSample={openSample}
        />
      </div>
    </div>
  );
};

interface BandChipProps {
  label: string;
  /** Muted annotation after the label (e.g. the tall-rail guard). */
  note?: string;
  title?: string;
  on: boolean;
  onToggle: () => void;
}

const BandChip: FC<BandChipProps> = ({ label, note, title, on, onToggle }) => (
  <button
    type="button"
    className={clsx(styles.bandChip, on && styles.bandChipOn)}
    onClick={onToggle}
    title={title}
  >
    {on ? <i className="bi bi-check" aria-hidden="true" /> : null}
    {label}
    {note && <span className={styles.bandChipNote}>· {note}</span>}
  </button>
);
