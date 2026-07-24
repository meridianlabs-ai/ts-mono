import clsx from "clsx";
import {
  CSSProperties,
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
  dotLadderStep,
  formatShort,
  GuideSegment,
  kStatusColor,
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
// Extra headroom so the tallest dot stack clears the band label.
const kTermPlotTop = kPlotTop + 10;
const kBinWidth = 8;
const kMaxPopoverScores = 4;
const kPostRunGutter = 72;
const kMarkerTop = 10;

/** HTML status dots (popovers): hollow ring for started, solid otherwise. */
const statusDotStyle = (status: Termination["status"]): CSSProperties =>
  status === "started"
    ? {
        background: "transparent",
        border: `1.5px solid ${kStatusColor.started}`,
      }
    : { background: kStatusColor[status] };

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

const svgOffsetTop = (event: ReactMouseEvent<SVGRectElement>): number =>
  event.currentTarget.ownerSVGElement?.getBoundingClientRect().top ?? 0;

const sampleTokens = (sample: SampleSummary): number | undefined => {
  const usage = sample.model_usage;
  if (!usage) return undefined;
  let total = 0;
  for (const u of Object.values(usage)) {
    total += u.total_tokens ?? 0;
  }
  return total > 0 ? total : undefined;
};

interface PopoverState {
  x: number;
  y: number;
  sample: SampleSummary;
  status: Termination["status"];
}

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
  /** Live eval — the terminations rail only ever grows between refreshes. */
  running?: boolean;
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
  running = false,
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
  // Running logs — monotonic growth: the rail derives from the densest bin
  // seen so far, so a live refresh never reflows the band shorter or steps
  // the dots back up the radius ladder. Keyed by window start (a new log
  // resets it); updated by an effect after the bins are computed.
  const [binHighWater, setBinHighWater] = useState({ key: 0, value: 0 });
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

  // Bin terminations by ~8px time slice up front — the densest stack picks
  // the radius-ladder step and sets the band's height. Skipped until the
  // width is known: with a zero-width plot every dot lands in one bin,
  // which would poison the running-log high-water mark.
  const termBins = new Map<number, Termination[]>();
  if (showTerminations && width > 0) {
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
  useEffect(() => {
    if (binHighWater.key !== timeWindow.start) {
      setBinHighWater({
        key: timeWindow.start,
        value: running ? maxBinCount : 0,
      });
    } else if (running && maxBinCount > binHighWater.value) {
      setBinHighWater({ key: timeWindow.start, value: maxBinCount });
    }
  }, [binHighWater, running, maxBinCount, timeWindow.start]);
  const effectiveMaxBin =
    running && binHighWater.key === timeWindow.start
      ? Math.max(maxBinCount, binHighWater.value)
      : maxBinCount;
  // Elastic rail (design canvas 34a): shrink the dots down the ladder as
  // density grows, then grow the band — uncapped — once the radius floors.
  const { r: dotRadius, pitch: dotPitch } = dotLadderStep(effectiveMaxBin);
  const termPlotBottom = Math.max(
    kPlotBottom,
    kTermPlotTop + 6 + effectiveMaxBin * dotPitch
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
  // With every band toggled off, the ◆ rail still needs room below the
  // diamonds — otherwise marker lines and labels garble the axis.
  const axisY = (bands.length === 0 ? kMarkerTop + 24 : cursor) + 6;
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
          // Abnormal statuses sink to the bottom (closest to the axis) so
          // error/limit dots are never buried under a completion stack.
          const sorted = [...items].sort((a, b) => {
            const abnormal = (t: Termination) =>
              t.status === "completed" ? 1 : 0;
            return abnormal(a) - abnormal(b);
          });
          const rowY = (row: number) => baseline - dotRadius - row * dotPitch;
          return (
            <g key={`bin-${bin}`}>
              {sorted.map((t, row) => {
                const hovered =
                  popover?.sample === t.sample && popover.status === t.status;
                const hollow = t.status === "started";
                return (
                  <circle
                    key={row}
                    className={styles.terminationDot}
                    cx={cx}
                    cy={rowY(row)}
                    r={hovered ? dotRadius + 1.5 : dotRadius}
                    fill={hollow ? "var(--bs-body-bg)" : kStatusColor[t.status]}
                    stroke={
                      hovered
                        ? "var(--bs-body-color)"
                        : hollow
                          ? kStatusColor.started
                          : "none"
                    }
                    strokeWidth={
                      hovered
                        ? 1.5
                        : hollow
                          ? Math.min(1.25, dotRadius * 0.7)
                          : 0
                    }
                  />
                );
              })}
              {/* Full-height invisible hit column — at r = 1.5 this is what
                  keeps per-dot hover workable. */}
              <rect
                className={styles.termHitColumn}
                x={bin * kBinWidth}
                y={hitTop}
                width={kBinWidth}
                height={Math.max(baseline - hitTop, 0)}
                onMouseMove={(event) => {
                  const my = event.clientY - svgOffsetTop(event);
                  const raw = Math.round((baseline - dotRadius - my) / dotPitch);
                  const row = Math.min(sorted.length - 1, Math.max(0, raw));
                  const t = sorted[row]!;
                  // Movement within one dot's slice keeps the open popover.
                  if (
                    popoverCloseTimer.current === null &&
                    popover?.sample === t.sample &&
                    popover.status === t.status
                  ) {
                    return;
                  }
                  openPopover({
                    sample: t.sample,
                    status: t.status,
                    x: cx,
                    y: rowY(row),
                  });
                }}
                onMouseLeave={scheduleClosePopover}
              />
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
          const isLog = marker.kind === "log";
          const mx = Math.min(plotRight + 32 + i * 16, width - 8);
          const selected = selectedMarker === key;
          // smaller head than in-run markers — the gutter is narrow
          const size = selected ? 9 : 6;
          return (
            <g
              key={`post-${key}`}
              className={clsx(styles.marker, styles.markerPostRun)}
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
                y1={kMarkerTop + 4}
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
                  styles.markerLabelHover,
                  isLog && styles.markerLabelLog,
                  selected && styles.markerLabelSelected
                )}
                x={mx - 9}
                y={kMarkerTop + 3}
                textAnchor="end"
              >
                {marker.label}
              </text>
            </g>
          );
        })}
      </g>
    );
  };

  // ── popovers ─────────────────────────────────────────────────────────

  const renderPopover = () => {
    if (!popover) return null;
    const top = popover.y + 14;
    const hold = () => openPopover(popover);
    const left = Math.min(
      Math.max(popover.x - 60, 0),
      Math.max(width - 340, 0)
    );
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
          style={statusDotStyle(status)}
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
