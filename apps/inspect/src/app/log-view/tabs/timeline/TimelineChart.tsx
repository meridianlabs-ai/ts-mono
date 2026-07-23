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
import { useResizeObserver } from "@tsmono/react/hooks";

import { SampleSummary } from "../../../../client/api/types";

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
const kDotRadius = 3.5;
const kDotRowStep = 9;
const kMaxDotRows = 6;
const kBinWidth = 8;
const kPostRunGutter = 72;
const kMarkerTop = 10;

const kStatusColor: Record<Termination["status"], string> = {
  completed: "#2f7d4f",
  error: "#b04a3c",
  limit: "#d4a72c",
  incomplete: "#6c757d",
};

const fmtTime = (sec: number): string =>
  new Date(sec * 1000).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
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

interface PopoverState {
  sample: SampleSummary;
  status: Termination["status"];
  x: number;
  y: number;
}

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
  limitCrossReference,
  onOpenSample,
}) => {
  const [width, setWidth] = useState(0);
  const chartRef = useResizeObserver(
    useCallback(
      (entry: ResizeObserverEntry) => setWidth(entry.contentRect.width),
      []
    )
  );
  const [popover, setPopover] = useState<PopoverState | null>(null);
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
  const plotRight = Math.max(width - gutter, plotLeft);

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
  const bands: Band[] = [];
  let cursor = 0;
  if (showActiveSamples && activeSeries.length > 0) {
    bands.push({ kind: "active", top: cursor });
    cursor += kBandHeight;
  }
  for (const model of connectionModels) {
    if (lanes[model]) {
      bands.push({ kind: "connections", model, top: cursor });
      cursor += kBandHeight;
    }
  }
  if (showTerminations) {
    bands.push({ kind: "terminations", top: cursor });
    cursor += kBandHeight;
  }
  const axisY = cursor + 6;
  const height = axisY + kAxisHeight;

  if (bands.length === 0 && markers.length === 0) {
    return null;
  }

  // ── band renderers ───────────────────────────────────────────────────

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
        {yTicks(y, dataMax)}
        <line
          className={styles.bandSeparator}
          x1={0}
          x2={plotRight}
          y1={band.top + kBandHeight - 4}
          y2={band.top + kBandHeight - 4}
        />
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
        {yTicks(y, dataMax)}
        <line
          className={styles.bandSeparator}
          x1={0}
          x2={plotRight}
          y1={band.top + kBandHeight - 4}
          y2={band.top + kBandHeight - 4}
        />
      </g>
    );
  };

  const renderTerminations = (band: Band) => {
    const baseline = band.top + kPlotBottom;
    // Bin by ~8px time slice; stacks grow up from the rail baseline —
    // column height is termination volume, x stays at the true slice.
    const bins = new Map<number, Termination[]>();
    for (const t of terminationDots) {
      const bin = Math.floor(x(t.time) / kBinWidth);
      const list = bins.get(bin) ?? [];
      list.push(t);
      bins.set(bin, list);
    }
    const dots: {
      cx: number;
      cy: number;
      t: Termination;
    }[] = [];
    const clusters: { cx: number; count: number }[] = [];
    for (const [bin, items] of bins) {
      const cx = bin * kBinWidth + kBinWidth / 2;
      // Abnormal statuses sink to the bottom (closest to the axis) and are
      // never absorbed into a counted cluster.
      const sorted = [...items].sort((a, b) => {
        const abnormal = (t: Termination) => (t.status === "completed" ? 1 : 0);
        return abnormal(a) - abnormal(b);
      });
      if (sorted.length <= kMaxDotRows) {
        sorted.forEach((t, row) => {
          dots.push({ cx, cy: baseline - row * kDotRowStep, t });
        });
      } else {
        const abnormal = sorted.filter((t) => t.status !== "completed");
        const normal = sorted.filter((t) => t.status === "completed");
        const shown = abnormal.slice(0, kMaxDotRows - 1);
        shown.forEach((t, row) => {
          dots.push({ cx, cy: baseline - row * kDotRowStep, t });
        });
        clusters.push({
          cx,
          count: normal.length + (abnormal.length - shown.length),
        });
      }
    }

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
        {/* Clusters render under dots — abnormal dots stay hoverable. */}
        {clusters.map((cluster, i) => (
          <g key={`cluster-${i}`}>
            <rect
              className={styles.clusterBar}
              x={cluster.cx - 3}
              y={band.top + kPlotTop}
              width={6}
              height={baseline - band.top - kPlotTop}
              rx={3}
            >
              <title>{`${cluster.count} terminations`}</title>
            </rect>
            <text
              className={styles.clusterCount}
              x={cluster.cx + 6}
              y={band.top + kPlotTop + 8}
            >
              ×{cluster.count}
            </text>
          </g>
        ))}
        {dots.map((dot, i) => {
          const hovered =
            popover?.sample === dot.t.sample &&
            popover?.status === dot.t.status;
          return (
            <circle
              key={i}
              className={styles.terminationDot}
              cx={dot.cx}
              cy={dot.cy}
              r={hovered ? 5 : kDotRadius}
              fill={kStatusColor[dot.t.status]}
              stroke={hovered ? "var(--bs-body-color)" : "none"}
              strokeWidth={hovered ? 1.5 : 0}
              onMouseEnter={() =>
                openPopover({
                  sample: dot.t.sample,
                  status: dot.t.status,
                  x: dot.cx,
                  y: dot.cy,
                })
              }
              onMouseLeave={scheduleClosePopover}
            />
          );
        })}
        <line
          className={styles.bandSeparator}
          x1={0}
          x2={plotRight}
          y1={band.top + kBandHeight - 4}
          y2={band.top + kBandHeight - 4}
        />
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
    const intervals = [300, 900, 1800, 3600, 7200, 14400, 43200, 86400];
    const plotSpan = plotRight - plotLeft;
    const interval = intervals.find((i) => (i / span) * plotSpan >= 80);
    if (interval) {
      for (
        let t = Math.ceil(timeWindow.start / interval) * interval;
        t < timeWindow.end;
        t += interval
      ) {
        const px = x(t);
        if (px < plotLeft + 110 || px > plotRight - 60) continue;
        ticks.push({ x: px, label: fmtTime(t), anchor: "middle" });
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

  // ── sample popover ───────────────────────────────────────────────────

  const renderPopover = () => {
    if (!popover) return null;
    const { sample, status } = popover;
    const preview = inputString(sample.input).join(" ");
    const tokens = sampleTokens(sample);
    const crossReference = limitCrossReference?.(sample);
    const completedAt = sample.completed_at
      ? new Date(sample.completed_at).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          second: "2-digit",
        })
      : undefined;
    const scores = sample.scores ? Object.entries(sample.scores) : [];
    const firstScore = scores[0];
    const left = Math.min(
      Math.max(popover.x - 60, 0),
      Math.max(width - 340, 0)
    );
    const statusWord =
      status === "limit" ? `${sample.limit ?? ""} limit`.trim() : status;
    return (
      <div
        className={styles.samplePopover}
        style={{ left, top: popover.y + 14 }}
        onMouseEnter={() => openPopover(popover)}
        onMouseLeave={scheduleClosePopover}
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
              {fmtCompact(sample.working_time)} /{" "}
              {fmtCompact(sample.total_time)}
            </div>
            {tokens !== undefined && (
              <Fragment>
                <div className={styles.popoverLabel}>Tokens</div>
                <div>{tokens.toLocaleString()}</div>
              </Fragment>
            )}
            <div className={styles.popoverLabel}>Retries</div>
            <div>{sample.retries ?? 0}</div>
            {firstScore && (
              <Fragment>
                <div className={styles.popoverLabel}>Score</div>
                <div className={styles.popoverScore}>
                  {firstScore[0]}: {formatShort(firstScore[1]?.value)}
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
    </div>
  );
};
