import clsx from "clsx";
import {
  FC,
  MouseEvent as ReactMouseEvent,
  useCallback,
  useMemo,
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
} from "../../useShowTimeline";

import { HistoryList } from "./HistoryList";
import { TimelineChart } from "./TimelineChart";
import {
  activeSamplesSeries,
  configMarkers,
  guideSegments,
  HistoryCategory,
  historyRows,
  logMarkers,
  terminations,
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
  return useMemo(() => {
    return {
      id: kLogViewTimelineTabId,
      label: "Timeline",
      scrollable: true,
      component: TimelineTab,
      componentProps: {
        evalSpec,
        evalStats,
        evalStatus,
        configUpdates,
        logUpdates,
        earlyStopping,
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

export const TimelineTab: FC<TimelineTabProps> = ({
  evalSpec,
  evalStats,
  evalStatus,
  configUpdates,
  logUpdates,
  earlyStopping,
}) => {
  const sampleData = useSelectedSampleSummaries().data;
  const samples = useMemo(() => sampleData ?? [], [sampleData]);
  const evalDescriptor = useEvalDescriptor();
  const { showSample, getSampleUrl } = useSampleNavigationActions();

  const runStart = isoToEpoch(evalStats?.started_at);
  const runEnd = isoToEpoch(evalStats?.completed_at);

  // Config retunes and tag/metadata edits share the ◆ marker rail.
  const markers = useMemo(
    () =>
      [
        ...configMarkers(configUpdates, runEnd),
        ...logMarkers(logUpdates, runEnd),
      ].sort((a, b) => a.time - b.time),
    [configUpdates, logUpdates, runEnd]
  );

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
    for (const marker of markers) {
      if (!marker.postRun) cover(marker.time);
    }
    for (const event of evalStats?.connection_limit_history ?? []) {
      cover(event.timestamp);
    }
    return end > start ? { start, end } : undefined;
  }, [runStart, runEnd, dots, markers, evalStats?.connection_limit_history]);

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
            evalSpec?.config?.max_samples,
            "max_samples",
            markers,
            window
          )
        : [],
    [evalSpec?.config?.max_samples, markers, window]
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

  const showActiveSamples =
    activeSeries.length > 0 && bandOn(timelineBandId("active"), true);
  const showTerminations =
    dots.length > 0 && bandOn(timelineBandId("terminations"), true);
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

  const [categoryOverrides, setCategoryOverrides] = useState<Record<
    string,
    boolean
  > | null>(null);
  const enabledCategories = useMemo(() => {
    const enabled = new Set<HistoryCategory>();
    // Everything on by default; the chips narrow from there.
    const defaults: Record<HistoryCategory, boolean> = {
      config: true,
      tags: true,
      runtime: true,
      connections: true,
    };
    for (const category of Object.keys(defaults) as HistoryCategory[]) {
      if (categoryOverrides?.[category] ?? defaults[category]) {
        enabled.add(category);
      }
    }
    return enabled;
  }, [categoryOverrides]);

  const toggleCategory = (category: HistoryCategory | "all") => {
    if (category === "all") {
      setCategoryOverrides({
        config: true,
        tags: true,
        runtime: true,
        connections: true,
      });
      return;
    }
    setCategoryOverrides({
      ...(categoryOverrides ?? {
        config: enabledCategories.has("config"),
        tags: enabledCategories.has("tags"),
        runtime: enabledCategories.has("runtime"),
        connections: enabledCategories.has("connections"),
      }),
      [category]: !enabledCategories.has(category),
    });
  };

  const [selectedEventKey, setSelectedEventKey] = useState<string | null>(null);

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
                on={showTerminations}
                onToggle={() =>
                  toggleBand(timelineBandId("terminations"), true)
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
            {/* Derived legend: built from the visible bands only. */}
            <span className={styles.legend}>
              <span className={styles.legendItem}>
                <span className={styles.legendDiamond} />
                config change
              </span>
              {markers.some((m) => m.kind === "log") && (
                <span className={styles.legendItem}>
                  <span className={styles.legendDiamondLog} />
                  tag/metadata edit
                </span>
              )}
              {showTerminations && (
                <>
                  <span className={styles.legendItem}>
                    <span
                      className={styles.legendDot}
                      style={{ background: "#2f7d4f" }}
                    />
                    completed
                  </span>
                  <span className={styles.legendItem}>
                    <span
                      className={styles.legendDot}
                      style={{ background: "#b04a3c" }}
                    />
                    error
                  </span>
                  <span className={styles.legendItem}>
                    <span
                      className={styles.legendDot}
                      style={{ background: "#d4a72c" }}
                    />
                    limit
                  </span>
                  {dots.some((dot) => dot.status === "cancelled") && (
                    <span className={styles.legendItem}>
                      <span
                        className={styles.legendDot}
                        style={{ background: "#6c757d" }}
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
                          border: "1.5px solid #6c757d",
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
            onSelectMarker={setSelectedEventKey}
            evalDescriptor={evalDescriptor}
            limitCrossReference={limitCrossReference}
            onOpenSample={openSample}
          />
        )}
        <HistoryList
          rows={rows}
          enabledCategories={enabledCategories}
          onToggleCategory={toggleCategory}
          selectedEventKey={selectedEventKey}
          onSelectEvent={setSelectedEventKey}
          onOpenSample={openSample}
        />
      </div>
    </div>
  );
};

interface BandChipProps {
  label: string;
  on: boolean;
  onToggle: () => void;
}

const BandChip: FC<BandChipProps> = ({ label, on, onToggle }) => (
  <button
    type="button"
    className={clsx(styles.bandChip, on && styles.bandChipOn)}
    onClick={onToggle}
  >
    {on ? <i className="bi bi-check" aria-hidden="true" /> : null}
    {label}
  </button>
);
