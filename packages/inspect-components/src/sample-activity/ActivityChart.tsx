import clsx from "clsx";
import {
  FC,
  Fragment,
  MouseEvent as ReactMouseEvent,
  ReactNode,
  useRef,
  useState,
} from "react";

import { useTimeout } from "@tsmono/react/hooks";

import styles from "./ActivityChart.module.css";
import {
  ActivityData,
  ActivityMarker,
  ActivitySpan,
  AgentRow,
  ContextPoint,
  fmtDay,
  fmtDurationWords,
  fmtTime,
  fmtTimeSec,
  fmtTokens,
  kCategoryColor,
  kScorerHue,
  StallRegion,
  TimeWindow,
} from "./activityData";
import {
  ActivityTooltip,
  HoverTarget,
  hoverTargetKey,
  kTooltipWidth,
} from "./ActivityTooltip";

// Task-timeline parity geometry (handoff decision 6).
const kBandHeight = 84;
const kBandLabelY = 14;
const kPlotTop = 22;
const kPlotBottom = 72;
const kAxisHeight = 28;
// 30px y-gutter for the common single-conversation case; multi-agent
// samples widen it to carry the agent gutter (handoff 10a).
const kYAxisWidth = 30;
const kYAxisWidthGutter = 130;
// Marks at the window end would otherwise sit on the svg edge and clip.
const kPlotRightInset = 10;
// The glyph rail above the bands (kMarkerHeadroom parity).
const kMarkerHeadroom = 18;
const kGlyphY = 12;
// Markers closer than this cluster into one glyph + ×N badge.
const kClusterGapPx = 10;
// Label only the N longest stalls to avoid clutter (handoff decision 2).
const kMaxStallLabels = 3;
// Working blocks (16px tall, centred between plot top and baseline).
const kWorkingBlockTop = 38;
const kWorkingBlockHeight = 16;
const kStallBracketTop = 58;
const kStallLabelY = 70;
// Merged model+tool band rows.
const kAgentRowPitch = 24;
const kAgentRowFirstLabelY = 28;
const kAgentSpanOffset = 32;
const kAgentSpanHeight = 11;
const kSubLaneHeight = 3.25;
// Rows past this fold into one "+N more" summary row (handoff 10a).
const kMaxAgentRows = 4;
const kFoldRowId = "__fold__";
// Gutter legend rows under the curve-band labels.
const kLegendPitch = 14;
// Density degrade: past ~1 span per 3px a row renders as occupancy columns.
const kDensityPxPerSpan = 3;
const kDensityColWidth = 2;
// Hover/click bins on a dense row aggregate columns to a readable window.
const kDensityHoverPx = 16;
// Tooltip behaviour (handoff 11b): show delay, flip-left margin.
const kTooltipDelayMs = 120;
const kTooltipFlipPx = 280;
// A curve hover within this many px of a context point reads that point.
const kContextPointSnapPx = 6;

/** The shared cursor: a time on the axis, anchored to a hovered span or
 *  marker start when one is hovered, else the raw pointer position. */
interface Cursor {
  x: number;
  t: number;
}

export interface ActivityChartProps {
  data: ActivityData;
  window: TimeWindow;
  showWorking: boolean;
  showMarkers: boolean;
  showTokens: boolean;
  showContext: boolean;
  showModelTool: boolean;
  /** Conversation rows unchecked in the agent gutter (persisted ids). */
  hiddenAgentIds?: string[];
  onToggleAgent?: (id: string) => void;
  /** Selected history-row key — its marker holds the active treatment. */
  selectedKey: string | null;
  /** Marker click: select + scroll to its history row (auto-widening). */
  onSelectMarker: (key: string | null) => void;
  /** Row hovered in the history list — its glyph lights up. */
  hoveredRowKey?: string | null;
  /** Hovering a glyph washes its history row(s); null clears. */
  onHoverMarker?: (keys: string[] | null) => void;
  /** Click-through to the Transcript via event uuid. */
  onOpenEvent?: (uuid: string, event: ReactMouseEvent) => void;
  /** Dense-band bin click: filter the history list to the bin's window. */
  onFilterWindow?: (window: TimeWindow) => void;
}

const kNoIds: string[] = [];

const truncateLabel = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** Rows past the cap fold into one grey summary row until expanded. */
const foldRows = (rows: AgentRow[], expanded: boolean): AgentRow[] => {
  if (expanded || rows.length <= kMaxAgentRows) return rows;
  const shown = rows.slice(0, kMaxAgentRows);
  const folded = rows.slice(kMaxAgentRows);
  const summary: AgentRow = {
    id: kFoldRowId,
    name: `+${folded.length} more`,
    model: folded.map((row) => row.name).join(", "),
    models: [],
    hue: kScorerHue,
    isSubAgent: false,
    blockedOn: [],
    spans: folded
      .flatMap((row) => row.spans)
      .sort((a, b) => a.start - b.start || a.end - b.end),
    bursts: folded.flatMap((row) => row.bursts),
    modelCount: folded.reduce((sum, row) => sum + row.modelCount, 0),
    toolCount: folded.reduce((sum, row) => sum + row.toolCount, 0),
    failedCount: folded.reduce((sum, row) => sum + row.failedCount, 0),
  };
  return [...shown, summary];
};

export const ActivityChart: FC<ActivityChartProps> = ({
  data,
  window: timeWindow,
  showWorking,
  showMarkers,
  showTokens,
  showContext,
  showModelTool,
  hiddenAgentIds = kNoIds,
  onToggleAgent,
  selectedKey,
  onSelectMarker,
  hoveredRowKey,
  onHoverMarker,
  onOpenEvent,
  onFilterWindow,
}) => {
  const [width, setWidth] = useState(0);
  // Callback ref, not useResizeObserver — the chart renders null while every
  // band is toggled off, so a mount-only effect could observe nothing.
  const resizeObserver = useRef<ResizeObserver | null>(null);
  const chartRef = (element: HTMLDivElement | null) => {
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
  };

  // ── hover state (handoff 11a): one cursor, one tooltip target ─────────
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [hoverTarget, setHoverTarget] = useState<HoverTarget | null>(null);
  // The tooltip appears kTooltipDelayMs after a target arrives; the shown
  // key trails the live target so a quick sweep across spans shows nothing.
  const [shownKey, setShownKey] = useState<string | null>(null);
  const targetKey = hoverTargetKey(hoverTarget);
  useTimeout(
    () => setShownKey(targetKey),
    targetKey !== null && shownKey !== targetKey ? kTooltipDelayMs : null
  );
  // Pointer over the tooltip itself (its footer is clickable) holds it.
  const [tooltipHeld, setTooltipHeld] = useState(false);
  const [foldExpanded, setFoldExpanded] = useState(false);

  const clearTarget = () => {
    if (!tooltipHeld) setHoverTarget(null);
  };
  const leaveChart = () => {
    setCursor(null);
    setHoverTarget(null);
    setShownKey(null);
    setTooltipHeld(false);
  };

  // ── conversation rows: fold, hide, gutter ─────────────────────────────
  const multiAgent = data.agentRows.length > 1;
  const displayRows = foldRows(data.agentRows, foldExpanded);
  const hidden = new Set(hiddenAgentIds);
  const visibleRows = displayRows.filter((row) => !hidden.has(row.id));
  // Hidden rows drop out of every band: the id set covers the folded rows
  // too, so a hidden fold row hides its members' curves and burn layers.
  const visibleRowIds = new Set<string>();
  for (const row of visibleRows) {
    if (row.id === kFoldRowId) {
      for (const folded of data.agentRows.slice(kMaxAgentRows)) {
        visibleRowIds.add(folded.id);
      }
    } else {
      visibleRowIds.add(row.id);
    }
  }
  /** Curve rows: the real conversation rows that are currently visible. */
  const curveRows = data.agentRows.filter((row) => visibleRowIds.has(row.id));

  const plotLeft = multiAgent ? kYAxisWidthGutter : kYAxisWidth;
  const plotRight = Math.max(width - kPlotRightInset, plotLeft);
  const plotWidth = plotRight - plotLeft;
  const span = timeWindow.end - timeWindow.start;

  const x = (t: number): number => {
    const clamped = Math.min(Math.max(t, timeWindow.start), timeWindow.end);
    return span > 0
      ? plotLeft + ((clamped - timeWindow.start) / span) * plotWidth
      : plotLeft;
  };
  const timeAt = (px: number): number =>
    plotWidth > 0
      ? timeWindow.start + ((px - plotLeft) / plotWidth) * span
      : timeWindow.start;

  // ── marker clusters (computed before the bands: a cluster's count box
  //    needs extra rail headroom, which shifts every band down) ──────────
  interface MarkerGroup {
    x: number;
    members: ActivityMarker[];
  }

  /** Count-box width for a cluster ("×12" is wider than "×2"); singles
   *  reserve just their glyph. */
  const badgeWidth = (count: number): number =>
    count > 1 ? `×${count}`.length * 5.5 + 8 : 9;

  // Merge markers whose glyphs or count boxes would collide — pixel-based
  // like the task timeline's ordinal boxes, so clusters dissolve on wider
  // windows and boxes never overlap their neighbours.
  const markerGroups: MarkerGroup[] = [];
  for (const marker of data.markers) {
    const mx = x(marker.time);
    const last = markerGroups[markerGroups.length - 1];
    const gap = last
      ? Math.max(
          kClusterGapPx,
          (badgeWidth(last.members.length + 1) + 9) / 2 + 2
        )
      : kClusterGapPx;
    if (last && mx - last.x < gap) {
      last.members.push(marker);
      last.x = (x(last.members[0]!.time) + mx) / 2;
    } else {
      markerGroups.push({ x: mx, members: [marker] });
    }
  }
  const hasClusterBadges = markerGroups.some(
    (group) => group.members.length > 1
  );
  // Clusters render a bordered count box ABOVE the glyph (task-timeline
  // ordinal-box convention) — the rail grows to fit it; without clusters
  // the handoff's 18px rail stands.
  const markerHeadroom = hasClusterBadges ? 30 : kMarkerHeadroom;
  const glyphY = hasClusterBadges ? 23 : kGlyphY;

  // ── band stack ────────────────────────────────────────────────────────
  interface Band {
    kind: "working" | "tokens" | "context" | "modelTool";
    top: number;
    /** Plot baseline offset within the band (modelTool grows with rows). */
    plotBottom: number;
    height: number;
  }

  const agentRowCount = displayRows.length;
  // The one variable-height band: grows with agent-row count (decision 6).
  const modelToolPlotBottom = Math.max(
    kPlotBottom,
    kAgentRowFirstLabelY - 4 + agentRowCount * kAgentRowPitch + 4
  );
  // Curve bands with a gutter legend grow to fit one legend line per row
  // plus the AT CURSOR caption.
  const legendPlotBottom = multiAgent
    ? Math.max(kPlotBottom, kPlotTop + 6 + curveRows.length * kLegendPitch + 8)
    : kPlotBottom;

  const bands: Band[] = [];
  let bandCursor = showMarkers && data.markers.length > 0 ? markerHeadroom : 0;
  const pushBand = (kind: Band["kind"], plotBottom: number) => {
    const height = plotBottom + (kBandHeight - kPlotBottom);
    bands.push({ kind, top: bandCursor, plotBottom, height });
    bandCursor += height;
  };
  // Band order (handoff 8a): activity → context → token burn → working.
  if (showModelTool && agentRowCount > 0) {
    pushBand("modelTool", modelToolPlotBottom);
  }
  if (showContext && data.contextSeries.length > 0) {
    pushBand("context", legendPlotBottom);
  }
  if (showTokens && data.tokenSeries.length > 0)
    pushBand("tokens", legendPlotBottom);
  if (showWorking) pushBand("working", kPlotBottom);

  const axisY = (bands.length === 0 ? markerHeadroom + 24 : bandCursor) + 6;
  const height = axisY + kAxisHeight;
  const plotTopY = bands[0] ? bands[0].top + kPlotTop - 4 : markerHeadroom;

  if (bands.length === 0 && (!showMarkers || data.markers.length === 0)) {
    return null;
  }

  // ── curve read-outs at a time ─────────────────────────────────────────

  /** Cumulative burn per visible row up to `t` (row order preserved). */
  const tokenValuesAt = (t: number): { row: AgentRow; value: number }[] =>
    curveRows.map((row) => {
      let value = 0;
      for (const point of data.tokensByRow[row.id] ?? []) {
        if (point.time > t) break;
        value = point.value;
      }
      return { row, value };
    });

  /** Nearest context point at or before `t`, per visible row. */
  const contextPointsAt = (
    t: number
  ): { row: AgentRow; point?: ContextPoint }[] =>
    curveRows.map((row) => {
      let point: ContextPoint | undefined;
      for (const candidate of data.contextByRow[row.id] ?? []) {
        if (candidate.time > t) break;
        point = candidate;
      }
      return { row, point };
    });

  // ── shared band chrome ────────────────────────────────────────────────

  const axisFrame = (band: Band) => (
    <Fragment>
      <line
        className={styles.axisLine}
        x1={plotLeft}
        x2={plotLeft}
        y1={band.top + kPlotTop - 4}
        y2={band.top + band.plotBottom}
      />
      <line
        className={styles.axisLine}
        x1={plotLeft}
        x2={plotRight}
        y1={band.top + band.plotBottom}
        y2={band.top + band.plotBottom}
      />
    </Fragment>
  );

  const bandLabel = (band: Band, text: string) => (
    <text
      className={styles.bandLabel}
      x={0}
      y={band.top + kBandLabelY}
      letterSpacing="0.4"
    >
      {text}
    </text>
  );

  const bandHeadline = (band: Band, text: string) => (
    <text
      className={styles.bandHeadline}
      x={plotRight}
      y={band.top + kBandLabelY}
      textAnchor="end"
    >
      {text}
    </text>
  );

  /** Gutter legend for a curve band (handoff 10a/11a): swatch · name ·
   *  value — the peak/total normally, the value AT CURSOR while hovering. */
  const gutterLegend = (
    band: Band,
    restingValue: (row: AgentRow) => string,
    cursorValue: (row: AgentRow, t: number) => string
  ): ReactNode => {
    if (!multiAgent) return null;
    return (
      <Fragment>
        {curveRows.map((row, i) => {
          const y = band.top + kPlotTop + 6 + i * kLegendPitch;
          return (
            <g key={`legend-${row.id}`}>
              <circle cx={10} cy={y - 3} r={3} fill={row.hue} />
              <text className={styles.legendName} x={17} y={y}>
                {truncateLabel(row.name, 11)}
              </text>
              {/* Right-aligned short of the y-tick labels, which keep the
                  gutter's right edge. */}
              <text
                className={styles.legendValue}
                x={plotLeft - 30}
                y={y}
                textAnchor="end"
              >
                {cursor ? cursorValue(row, cursor.t) : restingValue(row)}
              </text>
            </g>
          );
        })}
        {cursor && (
          <text
            className={styles.legendCaption}
            x={17}
            y={band.top + kPlotTop + 6 + curveRows.length * kLegendPitch}
          >
            AT CURSOR
          </text>
        )}
      </Fragment>
    );
  };

  const pointerPx = (event: ReactMouseEvent<SVGElement>): number => {
    const left =
      event.currentTarget.ownerSVGElement?.getBoundingClientRect().left ?? 0;
    return Math.min(Math.max(event.clientX - left, plotLeft), plotRight);
  };

  const pointerPy = (event: ReactMouseEvent<SVGElement>): number => {
    const top =
      event.currentTarget.ownerSVGElement?.getBoundingClientRect().top ?? 0;
    return event.clientY - top;
  };

  /** Read-out dots at the cursor time on a curve band. */
  const readoutDots = (dots: { y: number; hue: string }[]) =>
    cursor
      ? dots.map((dot, i) => (
          <circle
            key={`readout-${i}`}
            className={styles.readoutDot}
            cx={cursor.x}
            cy={dot.y}
            r={3.5}
            stroke={dot.hue}
          />
        ))
      : null;

  /** 0 / mid / max ticks in fmtTokens units. */
  const yTicks = (yOf: (v: number) => number, max: number) => {
    const values = [0, ...(max >= 4 ? [max / 2] : []), max];
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
          y={yOf(value) + (value === max ? 7 : 3)}
          textAnchor="end"
        >
          {fmtTokens(value)}
        </text>
      </g>
    ));
  };

  // ── WORKING / WAITING ─────────────────────────────────────────────────

  const renderWorking = (band: Band) => {
    // Only the N longest stalls get labels; brackets render for those same
    // stalls so the annotation layer stays quiet (decision 2).
    const labeled = [...data.stalls]
      .sort((a, b) => b.duration - a.duration)
      .slice(0, kMaxStallLabels)
      .filter((stall) => x(stall.end) - x(stall.start) >= 24);
    const stallLabel = (stall: StallRegion): string =>
      stall.retries !== undefined && stall.retries > 0
        ? `${fmtDurationWords(stall.duration)} · rate limit ×${stall.retries}`
        : fmtDurationWords(stall.duration);
    return (
      <g key="band-working">
        {bandLabel(band, "WORKING / WAITING")}
        {bandHeadline(
          band,
          `working ${fmtDurationWords(data.workingTime)} · total ${fmtDurationWords(data.totalTime)}`
        )}
        {data.workingSegments.map((segment, i) => (
          <rect
            key={`w-${i}`}
            className={styles.workingBlock}
            x={x(segment.start)}
            y={band.top + kWorkingBlockTop}
            width={Math.max(x(segment.end) - x(segment.start), 1)}
            height={kWorkingBlockHeight}
            rx={1}
          />
        ))}
        {labeled.map((stall, i) => {
          const retry = stall.retries !== undefined && stall.retries > 0;
          const x1 = x(stall.start) + 1;
          const x2 = x(stall.end) - 1;
          const yTop = band.top + kStallBracketTop;
          return (
            <Fragment key={`stall-${i}`}>
              <path
                className={
                  retry ? styles.stallBracketRetry : styles.stallBracket
                }
                d={`M ${x1} ${yTop} V ${yTop + 3} H ${x2} V ${yTop}`}
              />
              <text
                className={retry ? styles.stallLabelRetry : styles.stallLabel}
                x={(x1 + x2) / 2}
                y={band.top + kStallLabelY}
                textAnchor="middle"
              >
                {stallLabel(stall)}
              </text>
            </Fragment>
          );
        })}
        {/* Stall gaps carry the "Waiting …" tooltip (handoff 11b). */}
        {data.stalls.map((stall, i) => {
          const w = x(stall.end) - x(stall.start);
          if (w < 3) return null;
          return (
            <rect
              key={`stall-hit-${i}`}
              className={styles.stallHit}
              x={x(stall.start)}
              y={band.top + kWorkingBlockTop}
              width={w}
              height={band.plotBottom - kWorkingBlockTop}
              onMouseMove={(event) => {
                setCursor({ x: x(stall.start), t: stall.start });
                setHoverTarget({ kind: "stall", stall });
                // Keep the pointer x meaningful for the tooltip position.
                void event;
              }}
              onMouseLeave={clearTarget}
            />
          );
        })}
        {axisFrame(band)}
      </g>
    );
  };

  // ── TOKEN BURN ────────────────────────────────────────────────────────

  const renderTokens = (band: Band) => {
    const visibleTotal = curveRows.reduce(
      (sum, row) => sum + (data.tokenTotalsByRow[row.id] ?? 0),
      0
    );
    const max = Math.max(visibleTotal, 1);
    const yMax = max * 1.05;
    const y = (v: number): number =>
      band.top + band.plotBottom - (v / yMax) * (band.plotBottom - kPlotTop);

    // Stacked step areas, bottom-up in row order (handoff 10a): each burn
    // point lifts its own row's layer and every layer above it. Layers are
    // built from the time-sorted burn points so overlapping conversations
    // stack correctly; single-conversation samples degenerate to one layer.
    const points = data.tokenPoints.filter((p) => visibleRowIds.has(p.rowId));
    const running = new Map<string, number>();
    /** Per breakpoint, the cumulative stack top per row (row order). */
    const steps: { x: number; tops: number[] }[] = [
      { x: plotLeft, tops: curveRows.map(() => 0) },
    ];
    let lastX = plotLeft;
    points.forEach((point, i) => {
      running.set(point.rowId, (running.get(point.rowId) ?? 0) + point.burned);
      const px = x(point.time);
      // Decimate per pixel at scale — but always keep the final point.
      if (px - lastX < 1 && i < points.length - 1) return;
      let stack = 0;
      const tops = curveRows.map((row) => {
        stack += running.get(row.id) ?? 0;
        return stack;
      });
      steps.push({ x: px, tops });
      lastX = px;
    });

    const layerPath = (rowIndex: number): string => {
      const upper: string[] = [];
      const lower: string[] = [];
      steps.forEach((step, i) => {
        const next = steps[i + 1];
        const xEnd = next ? next.x : plotRight;
        const top = y(step.tops[rowIndex] ?? 0);
        const bottom = y(rowIndex > 0 ? (step.tops[rowIndex - 1] ?? 0) : 0);
        upper.push(`${step.x.toFixed(1)},${top.toFixed(1)}`);
        upper.push(`${xEnd.toFixed(1)},${top.toFixed(1)}`);
        lower.push(`${xEnd.toFixed(1)},${bottom.toFixed(1)}`);
        lower.push(`${step.x.toFixed(1)},${bottom.toFixed(1)}`);
      });
      return `M ${upper.join(" L ")} L ${lower.reverse().join(" L ")} Z`;
    };
    const edgePath = (rowIndex: number): string => {
      let d = "";
      steps.forEach((step, i) => {
        const next = steps[i + 1];
        const xEnd = next ? next.x : plotRight;
        const top = y(step.tops[rowIndex] ?? 0).toFixed(1);
        d += `${i === 0 ? "M" : " L"} ${step.x.toFixed(1)} ${top} L ${xEnd.toFixed(1)} ${top}`;
      });
      return d;
    };

    const shownNote =
      curveRows.length < data.agentRows.length
        ? ` · ${fmtTokens(visibleTotal)} shown`
        : "";
    const headline = multiAgent
      ? `${fmtTokens(data.totalTokens)} total${shownNote} · stacked by conversation`
      : `${fmtTokens(data.totalTokens)} total`;

    // Read-out dots sit on each layer's top edge at the cursor time.
    const dots = (() => {
      if (!cursor) return [];
      let stack = 0;
      return tokenValuesAt(cursor.t).map(({ row, value }) => {
        stack += value;
        return { y: y(stack), hue: multiAgent ? row.hue : "#495057" };
      });
    })();

    return (
      <g key="band-tokens">
        {bandLabel(band, "TOKEN BURN")}
        {bandHeadline(band, headline)}
        {multiAgent ? (
          curveRows.map((row, i) => (
            <Fragment key={`burn-${row.id}`}>
              <path
                className={styles.tokenLayer}
                d={layerPath(i)}
                fill={row.hue}
              />
              <path
                className={styles.tokenLayerEdge}
                d={edgePath(i)}
                stroke={row.hue}
              />
            </Fragment>
          ))
        ) : (
          <path className={styles.tokenSeries} d={edgePath(0)} />
        )}
        {axisFrame(band)}
        {yTicks(y, max)}
        {gutterLegend(
          band,
          (row) => fmtTokens(data.tokenTotalsByRow[row.id] ?? 0),
          (row, t) => {
            const value = tokenValuesAt(t).find((v) => v.row === row)?.value;
            return fmtTokens(value ?? 0);
          }
        )}
        {readoutDots(dots)}
      </g>
    );
  };

  // ── CONTEXT SIZE ──────────────────────────────────────────────────────

  const renderContext = (band: Band) => {
    const visibleCompactions = data.compactions.filter((drop) =>
      visibleRowIds.has(drop.rowId)
    );
    const dropMax = visibleCompactions.reduce(
      (m, c) => Math.max(m, c.before ?? 0),
      0
    );
    const peak = curveRows.reduce(
      (m, row) => Math.max(m, data.contextPeakByRow[row.id] ?? 0),
      0
    );
    const max = Math.max(peak, dropMax, 1);
    const yMax = max * 1.05;
    const y = (v: number): number =>
      band.top + band.plotBottom - (v / yMax) * (band.plotBottom - kPlotTop);

    /** One polyline run per row, split at that row's compaction drops so
     *  the line doesn't slope through the cliff — each drop restarts the
     *  run at tokens_after. */
    const rowRuns = (row: AgentRow): { x: number; y: number }[][] => {
      const series = data.contextByRow[row.id] ?? [];
      const drops = visibleCompactions.filter((d) => d.rowId === row.id);
      const runs: { x: number; y: number }[][] = [];
      let run: { x: number; y: number }[] = [];
      let dropIndex = 0;
      for (const point of series) {
        while (
          dropIndex < drops.length &&
          (drops[dropIndex]?.time ?? Infinity) <= point.time
        ) {
          const drop = drops[dropIndex]!;
          if (run.length > 0) runs.push(run);
          run =
            drop.after !== undefined
              ? [{ x: x(drop.time), y: y(drop.after) }]
              : [];
          dropIndex += 1;
        }
        run.push({ x: x(point.time), y: y(point.value) });
      }
      if (run.length > 0) runs.push(run);
      return runs;
    };

    // Dots only at sparse density — they'd smear into a rope at scale.
    const visiblePoints = curveRows.reduce(
      (sum, row) => sum + (data.contextByRow[row.id]?.length ?? 0),
      0
    );
    const sparse = visiblePoints <= plotWidth / 8;

    const headline = multiAgent
      ? `per conversation · peak ${fmtTokens(peak)}`
      : `peak ${fmtTokens(peak)}`;

    const dots = cursor
      ? contextPointsAt(cursor.t)
          .filter((v) => v.point !== undefined)
          .map((v) => ({
            y: y(v.point?.value ?? 0),
            hue: multiAgent ? v.row.hue : "#3a7bd5",
          }))
      : [];

    return (
      <g key="band-context">
        {bandLabel(band, "CONTEXT SIZE")}
        {bandHeadline(band, headline)}
        {curveRows.map((row) => (
          <g key={`ctx-${row.id}`}>
            {rowRuns(row).map((points, i) => (
              <polyline
                key={`ctx-run-${i}`}
                className={styles.contextSeries}
                style={multiAgent ? { stroke: row.hue } : undefined}
                points={points
                  .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
                  .join(" ")}
              />
            ))}
            {sparse &&
              (data.contextByRow[row.id] ?? []).map((point, i) => (
                <circle
                  key={`ctx-dot-${i}`}
                  className={styles.contextDot}
                  style={multiAgent ? { fill: row.hue } : undefined}
                  cx={x(point.time)}
                  cy={y(point.value)}
                  r={2}
                />
              ))}
          </g>
        ))}
        {(() => {
          // Every drop draws its dashed cliff, but annotations declutter:
          // a label only renders with enough horizontal room after the
          // previously labeled drop (same philosophy as the N-longest
          // stall labels) — dense compaction runs stay readable.
          let lastLabelX = -Infinity;
          return visibleCompactions.map((drop, i) => {
            if (drop.before === undefined || drop.after === undefined) {
              return null;
            }
            const dx = x(drop.time);
            const labeled = dx - lastLabelX >= 60;
            if (labeled) lastLabelX = dx;
            return (
              <Fragment key={`comp-${i}`}>
                <line
                  className={styles.compactionDrop}
                  x1={dx}
                  x2={dx}
                  y1={y(drop.before)}
                  y2={y(drop.after)}
                />
                {labeled && (
                  <text
                    className={styles.compactionLabel}
                    x={dx + 7}
                    y={y(drop.before) + 1}
                  >
                    {fmtTokens(drop.before)} → {fmtTokens(drop.after)}
                  </text>
                )}
              </Fragment>
            );
          });
        })()}
        {axisFrame(band)}
        {yTicks(y, max)}
        {gutterLegend(
          band,
          (row) => fmtTokens(data.contextPeakByRow[row.id] ?? 0),
          (row, t) => {
            const point = contextPointsAt(t).find((v) => v.row === row)?.point;
            return point ? fmtTokens(point.value) : "—";
          }
        )}
        {readoutDots(dots)}
      </g>
    );
  };

  // ── MODEL & TOOL ACTIVITY ─────────────────────────────────────────────

  /** A hand-off tool call renders only until its child conversation starts;
   *  the dotted blocked thread carries the rest (handoff 10a). */
  const spanDrawEnd = (row: AgentRow, s: ActivitySpan): number => {
    if (!s.handoffTo) return s.end;
    const blocked = row.blockedOn.find((b) => b.childId === s.handoffTo);
    return blocked ? Math.min(s.end, blocked.start) : s.end;
  };

  const spanWidth = (row: AgentRow, s: ActivitySpan): number =>
    Math.max(x(spanDrawEnd(row, s)) - x(s.start), 1.5);

  /** The single-conversation row label ("model · grader" / "model + tools")
   *  — the burst-label declutter reserves its extent. */
  const rowLabelText = (row: AgentRow): string =>
    `${row.model} ${row.role ? `· ${row.role}` : row.toolCount > 0 ? "+ tools" : ""}`;

  const hoveredSpan =
    hoverTarget?.kind === "span"
      ? hoverTarget.span
      : hoverTarget?.kind === "burst"
        ? hoverTarget.hovered
        : undefined;

  const hoverSpan = (row: AgentRow, s: ActivitySpan) => {
    setCursor({ x: x(s.start), t: s.start });
    // A sub-laned span belongs to a burst: the tooltip lists the burst.
    const burst =
      s.subLane !== undefined
        ? row.bursts.find((b) => s.start >= b.start && s.end <= b.end)
        : undefined;
    setHoverTarget(
      burst
        ? { kind: "burst", burst, row, hovered: s }
        : { kind: "span", span: s, row }
    );
  };

  const renderDiscreteRow = (row: AgentRow, rowTop: number): ReactNode => {
    const spanY = rowTop + (kAgentSpanOffset - kAgentRowFirstLabelY);
    const laneY = (s: ActivitySpan): number => {
      if (s.subLane === undefined || s.subLaneCount === undefined) return spanY;
      const count = Math.max(s.subLaneCount, 1);
      const pitch =
        count > 1 ? (kAgentSpanHeight + 1 - kSubLaneHeight) / (count - 1) : 0;
      return spanY + s.subLane * pitch;
    };
    return (
      <Fragment>
        {row.blockedOn.map((blocked, i) => {
          const x1 = x(blocked.start);
          const x2 = x(blocked.end);
          const yMid = spanY + kAgentSpanHeight / 2;
          return (
            <Fragment key={`blocked-${i}`}>
              <line
                className={styles.blockedThread}
                x1={x1}
                x2={x2}
                y1={yMid}
                y2={yMid}
              />
              {x2 - x1 >= 60 && (
                <text
                  className={styles.blockedLabel}
                  x={(x1 + x2) / 2}
                  y={spanY - 3}
                  textAnchor="middle"
                >
                  awaiting {blocked.childName}
                </text>
              )}
            </Fragment>
          );
        })}
        {row.spans.map((s, i) => {
          const subLaned = s.subLane !== undefined;
          const h = subLaned ? kSubLaneHeight : kAgentSpanHeight;
          const failedTool = s.kind === "tool" && s.failed;
          const isHovered = hoveredSpan === s;
          // Span hover (handoff 11a): the other spans in the same turn dim.
          const dim =
            hoveredSpan !== undefined &&
            !isHovered &&
            hoveredSpan.turn !== undefined &&
            hoveredSpan.turn === s.turn;
          return (
            <g key={`span-${i}`}>
              {s.kind === "model" &&
                s.retries !== undefined &&
                s.retries > 0 && (
                  <text
                    className={styles.retryBadge}
                    x={x(s.start) - 4}
                    y={spanY + 9}
                    textAnchor="end"
                  >
                    ×{s.retries}
                  </text>
                )}
              <rect
                className={clsx(
                  s.kind === "model" ? styles.modelSpan : styles.toolSpan,
                  failedTool && styles.failedSpan,
                  s.pending && styles.pendingSpan,
                  s.uuid && onOpenEvent && styles.clickableSpan,
                  isHovered && styles.spanHovered,
                  dim && styles.spanDim
                )}
                x={x(s.start)}
                y={laneY(s)}
                width={spanWidth(row, s)}
                height={h}
                rx={1}
                onMouseEnter={() => hoverSpan(row, s)}
                onMouseLeave={clearTarget}
                onClick={
                  s.uuid && onOpenEvent
                    ? (event) => onOpenEvent(s.uuid!, event)
                    : undefined
                }
              />
            </g>
          );
        })}
        {(() => {
          // Burst labels declutter greedily: the "bash ×3 · 1 failed"
          // annotation is designed for isolated bursts — with parallel tool
          // calls every turn, dozens of them smear over each other and the
          // row label. A label renders only with clear horizontal room
          // (after the row label and the previous burst label); the span
          // hover tooltip keeps the full detail for unlabeled bursts.
          let lastLabelEnd = multiAgent
            ? plotLeft
            : kYAxisWidth + 4 + rowLabelText(row).length * 5 + 12;
          return row.bursts.map((burst, i) => {
            const text =
              `${burst.label} ×${burst.count}` +
              (burst.failed > 0 ? ` · ${burst.failed} failed` : "") +
              (burst.folded > 0 ? ` · +${burst.folded}` : "");
            const mid = (x(burst.start) + x(burst.end)) / 2;
            const half = (text.length * 4.5) / 2;
            if (mid - half < lastLabelEnd + 8) return null;
            lastLabelEnd = mid + half;
            return (
              <text
                key={`burst-${i}`}
                className={styles.burstLabel}
                x={mid}
                y={rowTop - 4 + (kAgentSpanOffset - kAgentRowFirstLabelY)}
                textAnchor="middle"
              >
                {text}
              </text>
            );
          });
        })()}
      </Fragment>
    );
  };

  interface DensityColumn {
    model: number;
    tool: number;
    /** Failed calls overlapping this column (not a column-hit flag — the
     *  bin readout takes a max like the model/tool counts). */
    failed: number;
  }

  const renderDenseRow = (row: AgentRow, rowTop: number): ReactNode => {
    const spanY = rowTop + (kAgentSpanOffset - kAgentRowFirstLabelY);
    const rowH = kAgentSpanHeight + 1;
    const nCols = Math.max(1, Math.floor(plotWidth / kDensityColWidth));
    const cols: DensityColumn[] = Array.from({ length: nCols }, () => ({
      model: 0,
      tool: 0,
      failed: 0,
    }));
    for (const s of row.spans) {
      const c0 = Math.max(
        0,
        Math.floor((x(s.start) - plotLeft) / kDensityColWidth)
      );
      const c1 = Math.min(
        nCols - 1,
        Math.floor((x(s.end) - plotLeft) / kDensityColWidth)
      );
      for (let c = c0; c <= c1; c++) {
        const col = cols[c]!;
        if (s.kind === "model") col.model += 1;
        else col.tool += 1;
        if (s.failed) col.failed += 1;
      }
    }

    const binAt = (px: number): { label: string; window: TimeWindow } => {
      const binStart =
        plotLeft +
        Math.floor((px - plotLeft) / kDensityHoverPx) * kDensityHoverPx;
      const binEnd = Math.min(binStart + kDensityHoverPx, plotRight);
      const c0 = Math.max(
        0,
        Math.floor((binStart - plotLeft) / kDensityColWidth)
      );
      const c1 = Math.min(
        nCols - 1,
        Math.floor((binEnd - plotLeft) / kDensityColWidth)
      );
      // Column counts overcount spans crossing bins — good enough for a
      // hover readout, and O(width) like the strip itself.
      let model = 0;
      let tool = 0;
      let failed = 0;
      for (let c = c0; c <= c1; c++) {
        const col = cols[c]!;
        model = Math.max(model, col.model);
        tool = Math.max(tool, col.tool);
        failed = Math.max(failed, col.failed);
      }
      const windowStart = timeAt(binStart);
      const windowEnd = timeAt(binEnd);
      const label =
        `${fmtTime(windowStart)}–${fmtTime(windowEnd)} · ` +
        `${model} model · ${tool} tool${failed > 0 ? ` (${failed} failed)` : ""}`;
      return { label, window: { start: windowStart, end: windowEnd } };
    };

    return (
      <Fragment>
        {cols.map((col, i) => {
          const total = col.model + col.tool;
          if (total === 0) return null;
          const share = col.tool / total;
          return (
            <rect
              key={`col-${i}`}
              x={plotLeft + i * kDensityColWidth}
              y={spanY}
              width={kDensityColWidth}
              height={rowH}
              fill={share > 0.5 ? "#4f8f8b" : "#64748b"}
              opacity={0.3 + Math.min(0.6, total * 0.18)}
            />
          );
        })}
        {cols.map((col, i) =>
          col.failed > 0 ? (
            <rect
              key={`fail-${i}`}
              className={styles.densityFailure}
              x={plotLeft + i * kDensityColWidth}
              y={spanY}
              width={1.5}
              height={rowH}
            />
          ) : null
        )}
        <rect
          className={styles.densityHit}
          x={plotLeft}
          y={spanY - 2}
          width={Math.max(plotWidth, 0)}
          height={rowH + 4}
          onMouseMove={(event) => {
            const px = pointerPx(event);
            const bin = binAt(px);
            setCursor({ x: px, t: timeAt(px) });
            setHoverTarget({
              kind: "bin",
              label: bin.label,
              window: bin.window,
            });
          }}
          onMouseLeave={clearTarget}
          onClick={
            onFilterWindow
              ? (event) => {
                  onFilterWindow(binAt(pointerPx(event)).window);
                }
              : undefined
          }
        />
      </Fragment>
    );
  };

  /** Agent gutter row (handoff 10a): checkbox · hue swatch · name, with the
   *  model (and "· sub-agent") on a second line. The fold row's checkbox
   *  position carries the expand affordance instead. */
  const renderGutterRow = (row: AgentRow, rowTop: number): ReactNode => {
    const isFold = row.id === kFoldRowId;
    const on = !hidden.has(row.id);
    const nameY = rowTop + 6;
    const label = isFold
      ? `Show ${row.name.slice(1)} rows: ${row.model}`
      : `${on ? "Hide" : "Show"} ${row.name}`;
    const toggle = () =>
      isFold ? setFoldExpanded(true) : onToggleAgent?.(row.id);
    return (
      <g>
        {isFold ? (
          <text className={styles.gutterExpand} x={4} y={nameY}>
            ▸
          </text>
        ) : (
          <Fragment>
            <rect
              className={clsx(
                styles.gutterCheckbox,
                on && styles.gutterCheckboxOn
              )}
              x={4}
              y={nameY - 8}
              width={9}
              height={9}
              rx={2}
            />
            {on && (
              <path
                className={styles.gutterCheck}
                d={`M 6 ${nameY - 3.5} l 2 2 l 3.5 -4`}
              />
            )}
          </Fragment>
        )}
        <circle cx={27} cy={nameY - 3.5} r={3} fill={row.hue} />
        <text className={styles.gutterName} x={35} y={nameY}>
          {truncateLabel(row.name, 16)}
        </text>
        <text className={styles.gutterModel} x={35} y={nameY + 9}>
          {truncateLabel(
            `${row.model}${row.isSubAgent ? " · sub-agent" : ""}${row.role && !isFold ? ` · ${row.role}` : ""}`,
            22
          )}
        </text>
        <rect
          className={styles.gutterHit}
          x={0}
          y={rowTop - 4}
          width={plotLeft - 4}
          height={kAgentRowPitch}
          role={isFold ? "button" : "checkbox"}
          aria-checked={isFold ? undefined : on}
          aria-label={label}
          tabIndex={0}
          onClick={toggle}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              toggle();
            }
          }}
        />
      </g>
    );
  };

  const renderModelTool = (band: Band) => {
    const totalTools = data.agentRows.reduce(
      (sum, row) => sum + row.toolCount,
      0
    );
    const totalModels = data.agentRows.reduce(
      (sum, row) => sum + row.modelCount,
      0
    );
    const anyDense = visibleRows.some(
      (row) => row.spans.length > plotWidth / kDensityPxPerSpan
    );
    const shownCount = curveRows.length;
    const headline = [
      ...(multiAgent ? [`${data.agentRows.length} conversations`] : []),
      `${totalModels.toLocaleString()} model turns`,
      `${totalTools.toLocaleString()} tool calls`,
      ...(data.rejectedCount > 0 ? [`${data.rejectedCount} rejected`] : []),
      ...(anyDense ? ["per-pixel occupancy"] : []),
      ...(multiAgent && shownCount < data.agentRows.length
        ? [`${shownCount} of ${data.agentRows.length} shown`]
        : []),
    ].join(" · ");
    return (
      <g key="band-model-tool">
        {bandLabel(band, "MODEL & TOOL ACTIVITY")}
        {bandHeadline(band, headline)}
        {displayRows.map((row, i) => {
          const rowTop = band.top + kAgentRowFirstLabelY + i * kAgentRowPitch;
          const dense = row.spans.length > plotWidth / kDensityPxPerSpan;
          const on = !hidden.has(row.id);
          return (
            <g
              key={`row-${row.id}`}
              className={clsx(
                row.role && styles.roleRow,
                row.id === kFoldRowId && styles.foldRow
              )}
            >
              {multiAgent ? (
                renderGutterRow(row, rowTop)
              ) : (
                <text
                  className={styles.rowLabel}
                  x={kYAxisWidth + 4}
                  y={rowTop}
                >
                  {row.model}{" "}
                  <tspan className={styles.rowLabelMuted}>
                    {rowLabelText(row).slice(row.model.length + 1)}
                  </tspan>
                </text>
              )}
              {on &&
                (dense
                  ? renderDenseRow(row, rowTop)
                  : renderDiscreteRow(row, rowTop))}
            </g>
          );
        })}
        {axisFrame(band)}
      </g>
    );
  };

  // ── marker rail ───────────────────────────────────────────────────────

  const glyph = (
    category: ActivityMarker["category"],
    cx: number,
    cy: number
  ): ReactNode => {
    const color = kCategoryColor[category];
    switch (category) {
      case "error":
        return (
          <path
            d={`M ${cx - 3.5} ${cy - 3.5} L ${cx + 3.5} ${cy + 3.5} M ${cx + 3.5} ${cy - 3.5} L ${cx - 3.5} ${cy + 3.5}`}
            stroke={color}
            strokeWidth={1.8}
            strokeLinecap="round"
            fill="none"
          />
        );
      case "limit":
        return (
          <polygon
            points={`${cx},${cy - 4.5} ${cx - 4.5},${cy + 3.5} ${cx + 4.5},${cy + 3.5}`}
            fill={color}
          />
        );
      case "approval":
        return <circle cx={cx} cy={cy} r={4} fill={color} />;
      case "input":
        return (
          <rect
            x={cx - 3}
            y={cy - 3}
            width={6}
            height={6}
            fill="none"
            stroke={color}
            strokeWidth={1.5}
            transform={`rotate(45 ${cx} ${cy})`}
          />
        );
      case "interrupt":
        return (
          <Fragment>
            <rect x={cx - 4} y={cy - 4} width={2.6} height={8} fill={color} />
            <rect x={cx + 1.4} y={cy - 4} width={2.6} height={8} fill={color} />
          </Fragment>
        );
      case "compaction":
        return (
          <polygon
            points={`${cx - 4.5},${cy - 4} ${cx + 4.5},${cy - 4} ${cx},${cy + 4}`}
            fill={color}
          />
        );
      case "score":
        return (
          <Fragment>
            <circle
              cx={cx}
              cy={cy}
              r={4.5}
              fill="none"
              stroke={color}
              strokeWidth={1.5}
            />
            <circle cx={cx} cy={cy} r={1.6} fill={color} />
          </Fragment>
        );
    }
  };

  const renderMarkers = () => {
    return (
      <g key="markers">
        {markerGroups.map((group, i) => {
          const head = group.members[0]!;
          const keys = group.members.map((m) => m.key);
          const color = kCategoryColor[head.category];
          const active =
            (selectedKey !== null && keys.includes(selectedKey)) ||
            (hoveredRowKey != null && keys.includes(hoveredRowKey));
          const label =
            group.members.length > 1
              ? `${group.members.length} events: ${group.members
                  .map((m) => m.label)
                  .join("; ")}`
              : head.label;
          const activate = () => {
            setCursor({ x: group.x, t: head.time });
            setHoverTarget({
              kind: "marker",
              members: group.members,
              compaction:
                head.category === "compaction"
                  ? data.compactions.find((drop) => drop.key === head.key)
                  : undefined,
            });
            onHoverMarker?.(keys);
          };
          const deactivate = () => {
            clearTarget();
            onHoverMarker?.(null);
          };
          const selected = selectedKey !== null && keys.includes(selectedKey);
          const toggle = () =>
            onSelectMarker(selected ? null : (keys[0] ?? null));
          const cluster = group.members.length > 1;
          const boxW = badgeWidth(group.members.length);
          return (
            <g key={`marker-${i}`} className={styles.marker}>
              {/* Full-height stem in the hue at low opacity (decision 3). */}
              <line
                x1={group.x}
                x2={group.x}
                y1={glyphY + 6}
                y2={axisY}
                stroke={color}
                opacity={active ? 0.5 : 0.2}
              />
              {active && (
                <circle
                  cx={group.x}
                  cy={glyphY}
                  r={7.5}
                  fill={color}
                  opacity={0.18}
                />
              )}
              {glyph(head.category, group.x, glyphY)}
              {cluster && (
                <Fragment>
                  {/* Bordered count box centred above the glyph — the
                      task timeline's ordinal-box convention, so the count
                      reads as a badge on THIS mark rather than stray text
                      floating between neighbours. */}
                  <rect
                    className={styles.clusterBoxRect}
                    x={group.x - boxW / 2}
                    y={2}
                    width={boxW}
                    height={13}
                    rx={2}
                    stroke={color}
                  />
                  <text
                    className={styles.clusterBoxText}
                    x={group.x}
                    y={11.5}
                    textAnchor="middle"
                    fill={color}
                  >
                    ×{group.members.length}
                  </text>
                </Fragment>
              )}
              {/* The interactive element is this generous invisible rect on
                  the rail, NOT the group: the group's bounding box includes
                  the full-height stem, which would put its click point
                  mid-chart and let stems steal hovers from the bands. */}
              <rect
                className={styles.markerHit}
                x={group.x - Math.max(boxW, 12) / 2}
                y={1}
                width={Math.max(boxW, 12)}
                height={glyphY + 6}
                role="button"
                tabIndex={0}
                aria-label={label}
                onClick={toggle}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    toggle();
                  }
                }}
                onMouseEnter={activate}
                onMouseLeave={deactivate}
                onFocus={activate}
                onBlur={deactivate}
              />
            </g>
          );
        })}
      </g>
    );
  };

  // ── axis (task-timeline tick logic) ───────────────────────────────────

  const renderAxis = () => {
    const ticks: {
      x: number;
      label: string;
      anchor: "start" | "middle" | "end";
    }[] = [
      {
        x: plotLeft,
        label: `${fmtDay(timeWindow.start)}, ${fmtTime(timeWindow.start)}`,
        anchor: "start",
      },
      { x: plotRight, label: fmtTimeSec(timeWindow.end), anchor: "end" },
    ];
    const intervals = [
      15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400, 43200, 86400,
    ];
    const interval = intervals.find((i) => (i / span) * plotWidth >= 80);
    if (interval) {
      const fmt = interval < 60 ? fmtTimeSec : fmtTime;
      for (
        let t = Math.ceil(timeWindow.start / interval) * interval;
        t < timeWindow.end;
        t += interval
      ) {
        const px = x(t);
        // 80px right margin — the end tick renders with seconds, so it is
        // wider than the task timeline's and a 60px skip lets them collide.
        if (px < plotLeft + 110 || px > plotRight - 80) continue;
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
      </g>
    );
  };

  // ── shared cursor: hairline + axis pill (handoff 11a) ─────────────────

  const renderCursor = () => {
    if (!cursor) return null;
    const label = fmtTimeSec(cursor.t);
    const pillW = label.length * 5.6 + 10;
    const pillX = Math.min(
      Math.max(cursor.x - pillW / 2, plotLeft),
      plotRight - pillW
    );
    return (
      <g key="cursor">
        <line
          className={styles.cursorLine}
          x1={cursor.x}
          x2={cursor.x}
          y1={plotTopY}
          y2={axisY}
        />
        <rect
          className={styles.cursorPill}
          x={pillX}
          y={axisY + 4}
          width={pillW}
          height={14}
          rx={2}
        />
        <text
          className={styles.cursorPillText}
          x={pillX + pillW / 2}
          y={axisY + 14}
          textAnchor="middle"
        >
          {label}
        </text>
      </g>
    );
  };

  /** The full-plot hit surface under every band: moves the cursor with the
   *  pointer and reads the curve under it (a context point within a few px
   *  gets its own tooltip; otherwise the per-row values). */
  const onPlotMove = (event: ReactMouseEvent<SVGRectElement>) => {
    const px = pointerPx(event);
    const py = pointerPy(event);
    const t = timeAt(px);
    setCursor({ x: px, t });
    const band = bands.find((b) => py >= b.top && py < b.top + b.height);
    if (band?.kind === "context") {
      const yOf = (v: number) => {
        const visibleCompactions = data.compactions.filter((drop) =>
          visibleRowIds.has(drop.rowId)
        );
        const dropMax = visibleCompactions.reduce(
          (m, c) => Math.max(m, c.before ?? 0),
          0
        );
        const peak = curveRows.reduce(
          (m, row) => Math.max(m, data.contextPeakByRow[row.id] ?? 0),
          0
        );
        const yMax = Math.max(peak, dropMax, 1) * 1.05;
        return (
          band.top + band.plotBottom - (v / yMax) * (band.plotBottom - kPlotTop)
        );
      };
      // Snap to a context point when the pointer is right on it.
      let nearest: { row: AgentRow; point: ContextPoint } | undefined;
      let nearestDist = Infinity;
      for (const row of curveRows) {
        for (const point of data.contextByRow[row.id] ?? []) {
          const dist = Math.hypot(x(point.time) - px, yOf(point.value) - py);
          if (dist < nearestDist) {
            nearestDist = dist;
            nearest = { row, point };
          }
        }
      }
      if (nearest && nearestDist <= kContextPointSnapPx) {
        setHoverTarget({
          kind: "context",
          point: nearest.point,
          row: nearest.row,
        });
        return;
      }
      setHoverTarget({
        kind: "curve",
        band: "context",
        time: t,
        values: contextPointsAt(t).map(({ row, point }) => ({
          row,
          value: point?.value,
        })),
      });
      return;
    }
    if (band?.kind === "tokens") {
      setHoverTarget({
        kind: "curve",
        band: "tokens",
        time: t,
        values: tokenValuesAt(t),
      });
      return;
    }
    // Empty chart under the pointer: cursor only, no card.
    if (!tooltipHeld) setHoverTarget(null);
  };

  // ── tooltip placement (handoff 11b) ───────────────────────────────────
  // Below the activity band (never over the hovered row); follows the
  // pointer horizontally; flips left near the right edge.
  const renderTooltip = () => {
    if (!hoverTarget || !cursor || shownKey !== targetKey) return null;
    const activityBand = bands.find((b) => b.kind === "modelTool");
    const top = activityBand
      ? activityBand.top + activityBand.height - 6
      : (bands[0]?.top ?? markerHeadroom) + kPlotTop;
    const left =
      cursor.x > width - kTooltipFlipPx
        ? Math.max(cursor.x - 12 - kTooltipWidth, 0)
        : cursor.x + 12;
    return (
      <ActivityTooltip
        target={hoverTarget}
        onOpenEvent={onOpenEvent}
        style={{ left, top }}
        onMouseEnter={() => setTooltipHeld(true)}
        onMouseLeave={() => {
          setTooltipHeld(false);
          setHoverTarget(null);
        }}
      />
    );
  };

  return (
    <div
      ref={chartRef}
      className={styles.chart}
      style={{ height }}
      onMouseLeave={leaveChart}
    >
      {width > 0 && (
        <svg className={styles.svg} width={width} height={height}>
          <rect
            className={styles.plotHit}
            x={plotLeft}
            y={plotTopY}
            width={Math.max(plotWidth, 0)}
            height={Math.max(axisY - plotTopY, 0)}
            onMouseMove={onPlotMove}
          />
          {bands.map((band) => {
            switch (band.kind) {
              case "working":
                return renderWorking(band);
              case "tokens":
                return renderTokens(band);
              case "context":
                return renderContext(band);
              case "modelTool":
                return renderModelTool(band);
            }
          })}
          {renderAxis()}
          {renderCursor()}
          {showMarkers && renderMarkers()}
        </svg>
      )}
      {renderTooltip()}
    </div>
  );
};
