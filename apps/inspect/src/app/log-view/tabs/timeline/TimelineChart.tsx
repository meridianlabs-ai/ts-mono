import clsx from "clsx";
import {
  FC,
  Fragment,
  MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { inputString } from "@tsmono/inspect-common/utils";
import {
  buildStepPath,
  capGuideSegments,
  laneCapValues,
  type ConnectionLaneData,
  type PoolRetune,
} from "@tsmono/inspect-components/usage";

import { ScoreValue } from "../../../../@types/extraInspect";
import { SampleSummary } from "../../../../client/api/types";
import { kScoreTypeOther } from "../../../../constants";
import { EvalDescriptor } from "../../../samples/descriptor/types";
import { ScoreValueDisplay } from "../../../samples/header-v2/ScoreValueDisplay";

import styles from "./TimelineChart.module.css";
import {
  formatShort,
  GuideSegment,
  markerKey,
  StepPoint,
  Termination,
  TimelineMarker,
  TimeWindow,
} from "./timelineData";

const kBandHeight = 84;
const kBandLabelY = 14;
const kPlotTop = 22;
const kPlotBottom = 72;
const kAxisHeight = 28;
const kYAxisWidth = 30;
// Marks at the window end would otherwise sit on the svg edge and clip.
const kPlotRightInset = 10;
const kDotRadius = 3.5;
const kDotRowStep = 9;
// Extra headroom over the dot stacks so the hovered band's count sits on
// its own line, clear of the band label.
const kTermPlotTop = kPlotTop + 10;
const kMaxDotRows = 25;
const kBinWidth = 8;
const kMaxPopoverScores = 4;
const kMaxBinRows = 40;
const kPostRunGutter = 72;
const kMarkerTop = 10;

const kStatusColor: Record<Termination["status"], string> = {
  completed: "#2f7d4f",
  error: "#b04a3c",
  limit: "#d4a72c",
  incomplete: "#6c757d",
};

const kStatusLabel: Record<Termination["status"], string> = {
  completed: "completed",
  error: "errors",
  limit: "limits",
  incomplete: "incomplete",
};

/** Abnormal statuses render closest to the axis so they never hide. */
const kStatusOrder: Termination["status"][] = [
  "error",
  "limit",
  "incomplete",
  "completed",
];

const fmtTime = (sec: number): string =>
  new Date(sec * 1000).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

const fmtTimeSec = (sec: number): string =>
  new Date(sec * 1000).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });

const fmtDate = (sec: number): string =>
  new Date(sec * 1000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

const fmtCompact = (seconds?: number | null): string => {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  // Round once up front — rounding the remainder alone yields "1:60".
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
};

const sampleTokens = (sample: SampleSummary): number | undefined => {
  const usage = sample.model_usage;
  if (!usage) return undefined;
  let total = 0;
  for (const u of Object.values(usage)) {
    total += u.total_tokens ?? 0;
  }
  return total > 0 ? total : undefined;
};

type PopoverState = {
  /** Bin the popover belongs to — drives the column hover highlight. */
  binKey: number;
  x: number;
  y: number;
} & (
  | { kind: "sample"; sample: SampleSummary; status: Termination["status"] }
  | { kind: "bin"; items: Termination[] }
);

/** Crosshair + value readout for a hovered line band. */
interface LineHover {
  bandId: string;
  /** Cursor x, clamped to the plot. */
  x: number;
  /** Series y at the cursor time — the marker dot position. */
  dotY: number;
  /** Band plot top — anchors the tooltip. */
  top: number;
  label: string;
}

/** Stepped-series value at time t: the last point at or before t. */
const stepValueAt = (points: StepPoint[], t: number): number => {
  let value = 0;
  for (const point of points) {
    if (point.time > t) break;
    value = point.value;
  }
  return value;
};

const laneValueAt = (lane: ConnectionLaneData, t: number): number => {
  let value = lane.start;
  for (const event of lane.events) {
    if (event.timestamp <= t) value = event.new_limit;
  }
  return value;
};

export interface TimelineChartProps {
  window: TimeWindow;
  showActiveSamples: boolean;
  showTerminations: boolean;
  connectionModels: string[];
  activeSeries: StepPoint[];
  samplesGuide: GuideSegment[];
  terminationDots: Termination[];
  lanes: Record<string, ConnectionLaneData>;
  retunes: Record<string, PoolRetune[]>;
  markers: TimelineMarker[];
  selectedMarker: string | null;
  onSelectMarker: (key: string | null) => void;
  /** Renders sample scores in the popover with the samples-list treatment. */
  evalDescriptor?: EvalDescriptor | null;
  /** Amber cross-reference for a hovered limit-terminated dot, if any. */
  limitCrossReference?: (sample: SampleSummary) => string | undefined;
  onOpenSample?: (
    id: string | number,
    epoch: number,
    event: ReactMouseEvent
  ) => void;
}

export const TimelineChart: FC<TimelineChartProps> = ({
  window: timeWindow,
  showActiveSamples,
  showTerminations,
  connectionModels,
  activeSeries,
  samplesGuide,
  terminationDots,
  lanes,
  retunes,
  markers,
  selectedMarker,
  onSelectMarker,
  evalDescriptor,
  limitCrossReference,
  onOpenSample,
}) => {
  const [width, setWidth] = useState(0);
  // Callback ref, not useResizeObserver — the chart renders null until
  // samples arrive (and while every band is toggled off), so a mount-only
  // effect observes nothing and the width would stay 0 forever.
  const resizeObserver = useRef<ResizeObserver | null>(null);
  const chartRef = useCallback((element: HTMLDivElement | null) => {
    resizeObserver.current?.disconnect();
    resizeObserver.current = null;
    if (element) {
      const observer = new ResizeObserver((entries) => {
        if (entries[0]) {
          setWidth(entries[0].contentRect.width);
        }
      });
      observer.observe(element);
      resizeObserver.current = observer;
    }
  }, []);
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [lineHover, setLineHover] = useState<LineHover | null>(null);
  const popoverCloseTimer = useRef<number | null>(null);

  const openPopover = (state: PopoverState) => {
    if (popoverCloseTimer.current !== null) {
      window.clearTimeout(popoverCloseTimer.current);
      popoverCloseTimer.current = null;
    }
    setPopover(state);
  };
  const scheduleClosePopover = () => {
    if (popoverCloseTimer.current !== null) {
      window.clearTimeout(popoverCloseTimer.current);
    }
    popoverCloseTimer.current = window.setTimeout(() => setPopover(null), 250);
  };
  useEffect(
    () => () => {
      if (popoverCloseTimer.current !== null) {
        window.clearTimeout(popoverCloseTimer.current);
      }
    },
    []
  );

  const hasPostRun = markers.some((m) => m.postRun);
  const gutter = hasPostRun ? kPostRunGutter : 0;
  const plotLeft = kYAxisWidth;
  const plotRight = Math.max(width - gutter - kPlotRightInset, plotLeft);

  const span = timeWindow.end - timeWindow.start;
  const x = (t: number): number => {
    const clamped = Math.min(Math.max(t, timeWindow.start), timeWindow.end);
    return span > 0
      ? plotLeft +
          ((clamped - timeWindow.start) / span) * (plotRight - plotLeft)
      : plotLeft;
  };

  interface Band {
    kind: "active" | "connections" | "terminations";
    model?: string;
    top: number;
  }

  // Bin terminations by ~8px time slice up front — the deepest stack sets
  // the band's height (up to kMaxDotRows dot rows before a bin collapses).
  const termBins = new Map<number, Termination[]>();
  if (showTerminations) {
    for (const t of terminationDots) {
      const bin = Math.floor(x(t.time) / kBinWidth);
      const list = termBins.get(bin) ?? [];
      list.push(t);
      termBins.set(bin, list);
    }
  }
  let maxBinCount = 1;
  for (const items of termBins.values()) {
    maxBinCount = Math.max(maxBinCount, items.length);
  }
  const termStackRows = Math.min(maxBinCount, kMaxDotRows);
  const termPlotBottom = Math.max(
    kPlotBottom,
    kTermPlotTop + 6 + termStackRows * kDotRowStep
  );

  // Bands stack in the same order as the picker chips above the chart.
  const bands: Band[] = [];
  let cursor = 0;
  if (showActiveSamples && activeSeries.length > 0) {
    bands.push({ kind: "active", top: cursor });
    cursor += kBandHeight;
  }
  if (showTerminations) {
    bands.push({ kind: "terminations", top: cursor });
    cursor += termPlotBottom + 12;
  }
  for (const model of connectionModels) {
    if (lanes[model]) {
      bands.push({ kind: "connections", model, top: cursor });
      cursor += kBandHeight;
    }
  }
  const axisY = cursor + 6;
  const height = axisY + kAxisHeight;

  if (bands.length === 0 && markers.length === 0) {
    return null;
  }

  // ── band renderers ───────────────────────────────────────────────────

  // Left spine plus a baseline at y = 0 — each band reads as its own chart.
  const axisFrame = (band: Band, bottom: number = kPlotBottom) => (
    <Fragment>
      <line
        className={styles.axisLine}
        x1={plotLeft}
        x2={plotLeft}
        y1={band.top + kPlotTop - 4}
        y2={band.top + bottom}
      />
      <line
        className={styles.axisLine}
        x1={plotLeft}
        x2={plotRight}
        y1={band.top + bottom}
        y2={band.top + bottom}
      />
    </Fragment>
  );

  // ── line-band hover (crosshair + value tooltip) ──────────────────────

  const cursorTime = (
    event: ReactMouseEvent<SVGRectElement>
  ): { px: number; t: number } => {
    const left =
      event.currentTarget.ownerSVGElement?.getBoundingClientRect().left ?? 0;
    const px = Math.min(Math.max(event.clientX - left, plotLeft), plotRight);
    const t =
      plotRight > plotLeft
        ? timeWindow.start + ((px - plotLeft) / (plotRight - plotLeft)) * span
        : timeWindow.start;
    return { px, t };
  };

  const crosshair = (band: Band, hover: LineHover, dotClass?: string) => (
    <Fragment>
      <line
        className={styles.crosshair}
        x1={hover.x}
        x2={hover.x}
        y1={band.top + kPlotTop - 4}
        y2={band.top + kPlotBottom}
      />
      <circle className={dotClass} cx={hover.x} cy={hover.dotY} r={3} />
    </Fragment>
  );

  const lineHitRect = (
    band: Band,
    onMove: (event: ReactMouseEvent<SVGRectElement>) => void
  ) => (
    <rect
      className={styles.lineHit}
      x={plotLeft}
      y={band.top + kPlotTop - 4}
      width={Math.max(plotRight - plotLeft, 0)}
      height={kPlotBottom - kPlotTop + 4}
      onMouseMove={onMove}
      onMouseLeave={() => setLineHover(null)}
    />
  );

  // Y scale for the line bands: 0 / mid / max, deduped for tiny ranges.
  const yTicks = (yOf: (v: number) => number, max: number) => {
    const values = [0, ...(max >= 4 ? [Math.round(max / 2)] : []), max];
    return Array.from(new Set(values)).map((value) => (
      <g key={`ytick-${value}`}>
        <line
          className={styles.axisLine}
          x1={plotLeft - 3}
          x2={plotLeft}
          y1={yOf(value)}
          y2={yOf(value)}
        />
        <text
          className={styles.yTickLabel}
          x={plotLeft - 5}
          y={yOf(value) + 3}
          textAnchor="end"
        >
          {value}
        </text>
      </g>
    ));
  };

  const renderActive = (band: Band) => {
    // Running max — spreading a per-sample array into Math.max overflows
    // the engine argument limit on very large logs.
    const guideMax = samplesGuide.reduce((m, s) => Math.max(m, s.value), 0);
    const dataMax = activeSeries.reduce(
      (m, p) => Math.max(m, p.value),
      Math.max(guideMax, 1)
    );
    const yMax = dataMax * 1.1;
    const y = (v: number): number =>
      band.top + kPlotBottom - (v / yMax) * (kPlotBottom - kPlotTop);

    let path = "";
    let prev: StepPoint | undefined;
    for (const point of activeSeries) {
      const px = x(point.time);
      if (!prev) {
        path = `M ${px} ${y(point.value)}`;
      } else {
        path += ` L ${px} ${y(prev.value)} L ${px} ${y(point.value)}`;
      }
      prev = point;
    }
    if (prev) {
      path += ` L ${plotRight} ${y(prev.value)}`;
    }

    return (
      <g key="band-active">
        <text
          className={styles.bandLabel}
          x={0}
          y={band.top + kBandLabelY}
          letterSpacing="0.4"
        >
          ACTIVE SAMPLES
        </text>
        {samplesGuide.map((seg, i) => (
          <Fragment key={`guide-${i}`}>
            <line
              className={styles.limitGuide}
              x1={x(seg.from)}
              x2={x(seg.to)}
              y1={y(seg.value)}
              y2={y(seg.value)}
            />
            <text
              className={styles.guideLabel}
              x={x(seg.to) - 4}
              y={y(seg.value) - 3}
              textAnchor="end"
            >
              limit {seg.value}
            </text>
          </Fragment>
        ))}
        {path && <path className={styles.activeSeries} d={path} />}
        {axisFrame(band)}
        {yTicks(y, dataMax)}
        {lineHover?.bandId === "active" &&
          crosshair(band, lineHover, styles.hoverDotActive)}
        {lineHitRect(band, (event) => {
          const { px, t } = cursorTime(event);
          const value = stepValueAt(activeSeries, t);
          setLineHover({
            bandId: "active",
            x: px,
            dotY: y(value),
            top: band.top + kPlotTop,
            label: `${value} active · ${fmtTimeSec(t)}`,
          });
        })}
      </g>
    );
  };

  const renderConnections = (band: Band) => {
    const lane = lanes[band.model!]!;
    const laneRetunes = retunes[band.model!] ?? [];
    // Shared helpers window-filter post-run retunes — a cap amended after
    // the run never inflates the y-scale or steps the guide.
    const capValues = laneCapValues(lane, laneRetunes, timeWindow.end);
    const dataMax = Math.max(
      lane.configuredMax ?? 0,
      lane.peak,
      ...capValues,
      1
    );
    const yMax = dataMax * 1.1;
    const y = (v: number): number =>
      band.top + kPlotBottom - (v / yMax) * (kPlotBottom - kPlotTop);

    const path = buildStepPath(lane, timeWindow.start, x, y, plotRight);

    // Cap guide steps at retunes that changed the cap.
    const capSegments = capGuideSegments(
      lane,
      laneRetunes,
      timeWindow.end,
      x,
      plotLeft,
      plotRight
    );

    return (
      <g key={`band-connections-${band.model}`}>
        <text
          className={styles.bandLabel}
          x={0}
          y={band.top + kBandLabelY}
          letterSpacing="0.4"
        >
          CONNECTIONS ·{" "}
          <tspan className={styles.bandLabelModel}>{band.model}</tspan>
        </text>
        {lane.events
          .filter((e) => e.reason === "rate_limit")
          .map((e, i) => (
            <line
              key={`rl-${i}`}
              className={styles.rateLimitLine}
              x1={x(e.timestamp)}
              x2={x(e.timestamp)}
              y1={band.top + kPlotTop - 4}
              y2={band.top + kPlotBottom}
            >
              <title>{`rate limit · ${band.model} · ${e.old_limit} → ${e.new_limit}`}</title>
            </line>
          ))}
        {capSegments.map((seg, i) => (
          <Fragment key={`cap-${i}`}>
            <line
              className={styles.limitGuide}
              x1={seg.x1}
              x2={seg.x2}
              y1={y(seg.value)}
              y2={y(seg.value)}
            />
            <text
              className={styles.guideLabel}
              x={seg.x2 - 4}
              y={y(seg.value) - 3}
              textAnchor="end"
            >
              cap {seg.value}
            </text>
          </Fragment>
        ))}
        <path className={styles.connectionsSeries} d={path} />
        {axisFrame(band)}
        {yTicks(y, dataMax)}
        {lineHover?.bandId === `conn:${band.model}` &&
          crosshair(band, lineHover, styles.hoverDotConnections)}
        {lineHitRect(band, (event) => {
          const { px, t } = cursorTime(event);
          const value = laneValueAt(lane, t);
          setLineHover({
            bandId: `conn:${band.model}`,
            x: px,
            dotY: y(value),
            top: band.top + kPlotTop,
            label: `${value} connections · ${fmtTimeSec(t)}`,
          });
        })}
      </g>
    );
  };

  const renderTerminations = (band: Band) => {
    const baseline = band.top + termPlotBottom;
    const hitTop = band.top + kTermPlotTop - 4;
    const hitHeight = baseline - hitTop;

    const sortedBins = [...termBins.entries()].sort((a, b) => a[0] - b[0]);

    return (
      <g key="band-terminations">
        <text
          className={styles.bandLabel}
          x={0}
          y={band.top + kBandLabelY}
          letterSpacing="0.4"
        >
          SAMPLE TERMINATIONS
        </text>
        {sortedBins.map(([bin, items]) => {
          const cx = bin * kBinWidth + kBinWidth / 2;
          // Abnormal statuses sink to the bottom (closest to the axis)
          // and are never absorbed into a collapsed band.
          const sorted = [...items].sort((a, b) => {
            const abnormal = (t: Termination) =>
              t.status === "completed" ? 1 : 0;
            return abnormal(a) - abnormal(b);
          });
          const collapsed = sorted.length > kMaxDotRows;
          const shown = collapsed
            ? sorted
                .filter((t) => t.status !== "completed")
                .slice(0, kMaxDotRows - 1)
            : sorted;
          const groupHovered =
            popover?.kind === "bin" && popover.binKey === bin;
          return (
            <g key={`bin-${bin}`}>
              {/* Only a collapsed band answers hover as a group — plain
                    dot stacks popover per sample via the dots themselves. */}
              {collapsed && (
                <Fragment>
                  <rect
                    x={cx - 3}
                    y={band.top + kTermPlotTop}
                    width={6}
                    height={baseline - band.top - kTermPlotTop}
                    rx={3}
                    fill={kStatusColor.completed}
                    stroke={groupHovered ? "var(--bs-body-color)" : "none"}
                    strokeWidth={groupHovered ? 1.5 : 0}
                  />
                  {/* Hover-only — always-on counts collide when adjacent
                        bins collapse. */}
                  {groupHovered && (
                    <text
                      className={styles.clusterCount}
                      x={cx}
                      y={band.top + kTermPlotTop - 6}
                      textAnchor="middle"
                    >
                      {sorted.length - shown.length}
                    </text>
                  )}
                  <rect
                    className={styles.binHit}
                    x={cx - kBinWidth / 2}
                    y={hitTop}
                    width={kBinWidth}
                    height={hitHeight}
                    onMouseEnter={() =>
                      openPopover({
                        kind: "bin",
                        binKey: bin,
                        items,
                        x: cx,
                        y: band.top + kTermPlotTop,
                      })
                    }
                    onMouseLeave={scheduleClosePopover}
                  />
                </Fragment>
              )}
              {shown.map((t, row) => {
                const cy = baseline - kDotRadius - row * kDotRowStep;
                const hovered =
                  popover?.kind === "sample" &&
                  popover.sample === t.sample &&
                  popover.status === t.status;
                return (
                  <circle
                    key={row}
                    className={styles.terminationDot}
                    cx={cx}
                    cy={cy}
                    r={hovered ? 5 : kDotRadius}
                    fill={kStatusColor[t.status]}
                    stroke={hovered ? "var(--bs-body-color)" : "none"}
                    strokeWidth={hovered ? 1.5 : 0}
                    onMouseEnter={() =>
                      openPopover({
                        kind: "sample",
                        binKey: bin,
                        sample: t.sample,
                        status: t.status,
                        x: cx,
                        y: cy,
                      })
                    }
                    onMouseLeave={scheduleClosePopover}
                  />
                );
              })}
            </g>
          );
        })}
        {axisFrame(band, termPlotBottom)}
      </g>
    );
  };

  // ── axis ─────────────────────────────────────────────────────────────

  const renderAxis = () => {
    const ticks: {
      x: number;
      label: string;
      anchor: "start" | "middle" | "end";
    }[] = [
      {
        x: plotLeft,
        label: `${fmtDate(timeWindow.start)}, ${fmtTime(timeWindow.start)}`,
        anchor: "start",
      },
      { x: plotRight, label: fmtTime(timeWindow.end), anchor: "end" },
    ];
    const intervals = [
      15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400, 43200, 86400,
    ];
    const plotSpan = plotRight - plotLeft;
    const interval = intervals.find((i) => (i / span) * plotSpan >= 80);
    if (interval) {
      const fmt = interval < 60 ? fmtTimeSec : fmtTime;
      for (
        let t = Math.ceil(timeWindow.start / interval) * interval;
        t < timeWindow.end;
        t += interval
      ) {
        const px = x(t);
        if (px < plotLeft + 110 || px > plotRight - 60) continue;
        ticks.push({ x: px, label: fmt(t), anchor: "middle" });
      }
    }
    return (
      <g key="axis">
        <line
          className={styles.axisLine}
          x1={plotLeft}
          x2={plotRight}
          y1={axisY}
          y2={axisY}
        />
        {ticks.map((tick, i) => (
          <g key={i}>
            <line
              className={styles.axisLine}
              x1={tick.x}
              x2={tick.x}
              y1={axisY}
              y2={axisY + 3}
            />
            <text
              className={styles.axisLabel}
              x={tick.x}
              y={axisY + 14}
              textAnchor={tick.anchor}
            >
              {tick.label}
            </text>
          </g>
        ))}
        {hasPostRun && (
          <g>
            {/* axis break (⫽) then the compact post-run gutter */}
            <path
              className={styles.axisBreak}
              d={`M ${plotRight + 6} ${axisY - 4} L ${plotRight + 12} ${axisY + 4} M ${plotRight + 14} ${axisY - 4} L ${plotRight + 20} ${axisY + 4}`}
            />
            <line
              className={styles.axisLine}
              x1={plotRight + 24}
              x2={width}
              y1={axisY}
              y2={axisY}
            />
            <text
              className={styles.postRunLabel}
              x={plotRight + 26}
              y={axisY + 14}
            >
              post-run ›
            </text>
          </g>
        )}
      </g>
    );
  };

  // ── config markers ───────────────────────────────────────────────────

  const renderMarkers = () => {
    const postRun = markers.filter((m) => m.postRun);
    return (
      <g key="markers">
        {markers
          .filter((m) => !m.postRun)
          .map((marker) => {
            const key = markerKey(marker.kind, marker.index);
            const isLog = marker.kind === "log";
            const mx = x(marker.time);
            const selected = selectedMarker === key;
            const size = selected ? 12 : 8;
            return (
              <g
                key={key}
                className={styles.marker}
                onClick={() => onSelectMarker(selected ? null : key)}
              >
                <line
                  className={clsx(
                    styles.markerLine,
                    isLog && styles.markerLineLog,
                    selected && styles.markerLineSelected
                  )}
                  x1={mx}
                  x2={mx}
                  y1={kMarkerTop + 6}
                  y2={axisY}
                />
                <rect
                  className={clsx(
                    styles.markerDiamond,
                    isLog && styles.markerDiamondLog,
                    selected && styles.markerDiamondSelected
                  )}
                  x={mx - size / 2}
                  y={kMarkerTop - size / 2}
                  width={size}
                  height={size}
                  transform={`rotate(45 ${mx} ${kMarkerTop})`}
                >
                  <title>{marker.label}</title>
                </rect>
                <text
                  className={clsx(
                    styles.markerLabel,
                    isLog && styles.markerLabelLog,
                    selected && styles.markerLabelSelected
                  )}
                  x={mx + 12}
                  y={kMarkerTop + 3}
                >
                  {marker.label}
                </text>
              </g>
            );
          })}
        {postRun.map((marker, i) => {
          const key = markerKey(marker.kind, marker.index);
          const mx = Math.min(plotRight + 32 + i * 16, width - 8);
          const selected = selectedMarker === key;
          return (
            <rect
              key={`post-${key}`}
              className={clsx(
                styles.markerDiamond,
                marker.kind === "log" && styles.markerDiamondLog,
                styles.markerDiamondPostRun,
                selected && styles.markerDiamondSelected
              )}
              x={mx - 3.5}
              y={axisY - 12}
              width={7}
              height={7}
              transform={`rotate(45 ${mx} ${axisY - 8.5})`}
              onClick={() => onSelectMarker(selected ? null : key)}
            >
              <title>{marker.label}</title>
            </rect>
          );
        })}
      </g>
    );
  };

  // ── popovers ─────────────────────────────────────────────────────────

  const renderPopover = () => {
    if (!popover) return null;
    const left = Math.min(
      Math.max(popover.x - 60, 0),
      Math.max(width - 340, 0)
    );
    const top = popover.y + 14;
    const hold = () => openPopover(popover);
    if (popover.kind === "bin") {
      return (
        <BinPopover
          items={popover.items}
          left={left}
          top={top}
          onHold={hold}
          onRelease={scheduleClosePopover}
          onOpenSample={onOpenSample}
        />
      );
    }
    return (
      <SamplePopover
        sample={popover.sample}
        status={popover.status}
        left={left}
        top={top}
        scores={scoreRowsFor(popover.sample, evalDescriptor)}
        crossReference={limitCrossReference?.(popover.sample)}
        onHold={hold}
        onRelease={scheduleClosePopover}
        onOpenSample={onOpenSample}
      />
    );
  };

  return (
    <div ref={chartRef} className={styles.chart} style={{ height }}>
      {width > 0 && (
        <svg className={styles.svg} width={width} height={height}>
          {bands.map((band) =>
            band.kind === "active"
              ? renderActive(band)
              : band.kind === "connections"
                ? renderConnections(band)
                : renderTerminations(band)
          )}
          {renderAxis()}
          {renderMarkers()}
        </svg>
      )}
      {renderPopover()}
      {lineHover && (
        <div
          className={styles.lineTooltip}
          style={
            lineHover.x > width - 160
              ? {
                  left: lineHover.x - 10,
                  top: lineHover.top,
                  transform: "translateX(-100%)",
                }
              : { left: lineHover.x + 10, top: lineHover.top }
          }
        >
          {lineHover.label}
        </div>
      )}
    </div>
  );
};

// ── popover components ─────────────────────────────────────────────────

interface ScoreRow {
  key: string;
  name: string;
  value: ScoreValue | undefined;
  scoreType: string;
}

// Descriptor-typed rows (pass/fail circles, tones) when available;
// plain formatted text otherwise (e.g. scorers absent from the header).
const scoreRowsFor = (
  sample: SampleSummary,
  evalDescriptor: EvalDescriptor | null | undefined
): ScoreRow[] => {
  if (!sample.scores) return [];
  if (evalDescriptor && evalDescriptor.scores.length > 0) {
    return evalDescriptor.scores
      .map((label) => ({
        key: `${label.scorer}.${label.name}`,
        name: label.name,
        value: evalDescriptor.score(sample, label)?.value,
        scoreType: evalDescriptor.scoreDescriptor(label).scoreType,
      }))
      .filter((row) => row.value !== undefined && row.value !== null);
  }
  return Object.entries(sample.scores).map(([name, score]) => ({
    key: name,
    name,
    value: formatShort(score?.value),
    scoreType: kScoreTypeOther,
  }));
};

interface PopoverBaseProps {
  left: number;
  top: number;
  /** Keeps the popover open while the pointer is inside it. */
  onHold: () => void;
  onRelease: () => void;
  onOpenSample?: (
    id: string | number,
    epoch: number,
    event: ReactMouseEvent
  ) => void;
}

interface SamplePopoverProps extends PopoverBaseProps {
  sample: SampleSummary;
  status: Termination["status"];
  scores: ScoreRow[];
  crossReference?: string;
}

const SamplePopover: FC<SamplePopoverProps> = ({
  sample,
  status,
  scores,
  crossReference,
  left,
  top,
  onHold,
  onRelease,
  onOpenSample,
}) => {
  const preview = inputString(sample.input).join(" ");
  const tokens = sampleTokens(sample);
  const completedAt = sample.completed_at
    ? new Date(sample.completed_at).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      })
    : undefined;
  const shownScores = scores.slice(0, kMaxPopoverScores);
  const statusWord =
    status === "limit" ? `${sample.limit ?? ""} limit`.trim() : status;
  return (
    <div
      className={styles.samplePopover}
      style={{ left, top }}
      onMouseEnter={onHold}
      onMouseLeave={onRelease}
    >
      <div className={styles.popoverHeader}>
        <span
          className={styles.popoverStatusDot}
          style={{ background: kStatusColor[status] }}
        />
        <span className={styles.popoverSampleId}>Sample {sample.id}</span>
        <span className={styles.popoverEpoch}>epoch {sample.epoch}</span>
        <span
          className={styles.popoverStatusWord}
          style={{ color: kStatusColor[status] }}
        >
          {statusWord}
        </span>
      </div>
      <div className={styles.popoverBody}>
        {preview && <div className={styles.popoverInput}>{preview}</div>}
        <div className={styles.popoverGrid}>
          {completedAt && (
            <Fragment>
              <div className={styles.popoverLabel}>Terminated</div>
              <div>
                {completedAt}
                {sample.limit ? ` — hit ${sample.limit}` : ""}
              </div>
            </Fragment>
          )}
          <div className={styles.popoverLabel}>Working / total</div>
          <div>
            {fmtCompact(sample.working_time)} / {fmtCompact(sample.total_time)}
          </div>
          {tokens !== undefined && (
            <Fragment>
              <div className={styles.popoverLabel}>Tokens</div>
              <div>{tokens.toLocaleString()}</div>
            </Fragment>
          )}
          <div className={styles.popoverLabel}>Retries</div>
          <div>{sample.retries ?? 0}</div>
          {shownScores.map((row) => (
            <Fragment key={row.key}>
              <div className={styles.popoverLabel}>{row.name}</div>
              <div>
                <ScoreValueDisplay
                  value={row.value}
                  scoreType={row.scoreType}
                  size={15}
                />
              </div>
            </Fragment>
          ))}
          {scores.length > shownScores.length && (
            <Fragment>
              <div />
              <div className={styles.popoverMore}>
                +{scores.length - shownScores.length} more scores
              </div>
            </Fragment>
          )}
        </div>
        {crossReference && (
          <div className={styles.popoverCallout}>{crossReference}</div>
        )}
        {onOpenSample && (
          <button
            type="button"
            className={styles.popoverOpen}
            onClick={(event) => onOpenSample(sample.id, sample.epoch, event)}
          >
            Open sample →
          </button>
        )}
      </div>
    </div>
  );
};

interface BinPopoverProps extends PopoverBaseProps {
  items: Termination[];
}

const BinPopover: FC<BinPopoverProps> = ({
  items,
  left,
  top,
  onHold,
  onRelease,
  onOpenSample,
}) => {
  let minTime = Infinity;
  let maxTime = -Infinity;
  const counts = new Map<Termination["status"], number>();
  for (const t of items) {
    minTime = Math.min(minTime, t.time);
    maxTime = Math.max(maxTime, t.time);
    counts.set(t.status, (counts.get(t.status) ?? 0) + 1);
  }
  const minLabel = fmtTimeSec(minTime);
  const maxLabel = fmtTimeSec(maxTime);
  const timeLabel =
    minLabel === maxLabel ? minLabel : `${minLabel} – ${maxLabel}`;
  const sorted = [...items].sort((a, b) => {
    const abnormal = (t: Termination) => (t.status === "completed" ? 1 : 0);
    return abnormal(a) - abnormal(b) || a.time - b.time;
  });
  const shown = sorted.slice(0, kMaxBinRows);
  return (
    <div
      className={styles.samplePopover}
      style={{ left, top }}
      onMouseEnter={onHold}
      onMouseLeave={onRelease}
    >
      <div className={styles.popoverHeader}>
        <span className={styles.popoverSampleId}>
          {items.length} terminations
        </span>
        <span className={styles.popoverEpoch}>{timeLabel}</span>
      </div>
      <div className={styles.popoverBody}>
        <div className={styles.popoverBreakdown}>
          {kStatusOrder
            .filter((status) => counts.has(status))
            .map((status) => (
              <span key={status} className={styles.breakdownItem}>
                <span
                  className={styles.popoverStatusDot}
                  style={{ background: kStatusColor[status] }}
                />
                {counts.get(status)} {kStatusLabel[status]}
              </span>
            ))}
        </div>
        <div className={styles.popoverBinList}>
          {shown.map((t) => (
            <button
              type="button"
              key={`${t.sample.id}-${t.sample.epoch}`}
              className={styles.popoverBinRow}
              onClick={(event) =>
                onOpenSample?.(t.sample.id, t.sample.epoch, event)
              }
            >
              <span
                className={styles.popoverStatusDot}
                style={{ background: kStatusColor[t.status] }}
              />
              <span className={styles.popoverSampleId}>{t.sample.id}</span>
              <span className={styles.popoverEpoch}>
                epoch {t.sample.epoch}
              </span>
              <span className={styles.binRowTime}>{fmtTimeSec(t.time)}</span>
            </button>
          ))}
          {sorted.length > shown.length && (
            <div className={styles.popoverMore}>
              +{sorted.length - shown.length} more
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
