import clsx from "clsx";
import {
  FC,
  Fragment,
  MouseEvent as ReactMouseEvent,
  ReactNode,
  useRef,
  useState,
} from "react";

import styles from "./ActivityChart.module.css";
import {
  ActivityData,
  ActivityMarker,
  ActivitySpan,
  AgentRow,
  fmtDay,
  fmtDurationWords,
  fmtTime,
  fmtTimeSec,
  fmtTokens,
  kCategoryColor,
  StallRegion,
  TimeWindow,
} from "./activityData";

// Task-timeline parity geometry (handoff decision 6).
const kBandHeight = 84;
const kBandLabelY = 14;
const kPlotTop = 22;
const kPlotBottom = 72;
const kAxisHeight = 28;
const kYAxisWidth = 30;
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
// Density degrade: past ~1 span per 3px a row renders as occupancy columns.
const kDensityPxPerSpan = 3;
const kDensityColWidth = 2;
// Hover/click bins on a dense row aggregate columns to a readable window.
const kDensityHoverPx = 16;

/** Crosshair + value readout for a hovered curve band. */
interface LineHover {
  bandId: string;
  x: number;
  dotY: number;
  top: number;
  label: string;
}

interface SpanHover {
  x: number;
  span: ActivitySpan;
  row: AgentRow;
}

interface MarkerHover {
  x: number;
  members: ActivityMarker[];
}

interface BinHover {
  x: number;
  top: number;
  label: string;
  window: TimeWindow;
}

export interface ActivityChartProps {
  data: ActivityData;
  window: TimeWindow;
  showWorking: boolean;
  showMarkers: boolean;
  showTokens: boolean;
  showContext: boolean;
  showModelTool: boolean;
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

export const ActivityChart: FC<ActivityChartProps> = ({
  data,
  window: timeWindow,
  showWorking,
  showMarkers,
  showTokens,
  showContext,
  showModelTool,
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

  const [lineHover, setLineHover] = useState<LineHover | null>(null);
  const [spanHover, setSpanHover] = useState<SpanHover | null>(null);
  const [markerHover, setMarkerHover] = useState<MarkerHover | null>(null);
  const [binHover, setBinHover] = useState<BinHover | null>(null);

  const plotLeft = kYAxisWidth;
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

  const agentRowCount = data.agentRows.length;
  // The one variable-height band: grows with agent-row count (decision 6).
  const modelToolPlotBottom = Math.max(
    kPlotBottom,
    kAgentRowFirstLabelY - 4 + agentRowCount * kAgentRowPitch + 4
  );

  const bands: Band[] = [];
  let cursor = showMarkers && data.markers.length > 0 ? markerHeadroom : 0;
  const pushBand = (kind: Band["kind"], plotBottom: number) => {
    const height = plotBottom + (kBandHeight - kPlotBottom);
    bands.push({ kind, top: cursor, plotBottom, height });
    cursor += height;
  };
  if (showWorking) pushBand("working", kPlotBottom);
  if (showTokens && data.tokenSeries.length > 0)
    pushBand("tokens", kPlotBottom);
  if (showContext && data.contextSeries.length > 0) {
    pushBand("context", kPlotBottom);
  }
  if (showModelTool && agentRowCount > 0) {
    pushBand("modelTool", modelToolPlotBottom);
  }

  const axisY = (bands.length === 0 ? markerHeadroom + 24 : cursor) + 6;
  const height = axisY + kAxisHeight;

  if (bands.length === 0 && (!showMarkers || data.markers.length === 0)) {
    return null;
  }

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

  const cursorTime = (
    event: ReactMouseEvent<SVGRectElement>
  ): { px: number; t: number } => {
    const left =
      event.currentTarget.ownerSVGElement?.getBoundingClientRect().left ?? 0;
    const px = Math.min(Math.max(event.clientX - left, plotLeft), plotRight);
    return { px, t: timeAt(px) };
  };

  const crosshair = (band: Band, hover: LineHover, dotClass: string) => (
    <Fragment>
      <line
        className={styles.crosshair}
        x1={hover.x}
        x2={hover.x}
        y1={band.top + kPlotTop - 4}
        y2={band.top + band.plotBottom}
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
      width={Math.max(plotWidth, 0)}
      height={band.plotBottom - kPlotTop + 4}
      onMouseMove={onMove}
      onMouseLeave={() => setLineHover(null)}
    />
  );

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
        {axisFrame(band)}
      </g>
    );
  };

  // ── TOKEN BURN ────────────────────────────────────────────────────────

  const tokenValueAt = (t: number): number => {
    let value = 0;
    for (const point of data.tokenSeries) {
      if (point.time > t) break;
      value = point.value;
    }
    return value;
  };

  const renderTokens = (band: Band) => {
    const max = Math.max(data.totalTokens, 1);
    const yMax = max * 1.05;
    const y = (v: number): number =>
      band.top + kPlotBottom - (v / yMax) * (kPlotBottom - kPlotTop);

    // Cumulative step curve, decimated per pixel at scale.
    let d = `M ${plotLeft} ${band.top + kPlotBottom}`;
    let lastX = plotLeft;
    for (const point of data.tokenSeries) {
      const px = x(point.time);
      if (
        px - lastX >= 1 ||
        point === data.tokenSeries[data.tokenSeries.length - 1]
      ) {
        d += ` H ${px.toFixed(1)} V ${y(point.value).toFixed(1)}`;
        lastX = px;
      }
    }
    d += ` H ${plotRight}`;

    return (
      <g key="band-tokens">
        {bandLabel(band, "TOKEN BURN")}
        {bandHeadline(band, `${fmtTokens(data.totalTokens)} total`)}
        <path className={styles.tokenSeries} d={d} />
        {axisFrame(band)}
        {yTicks(y, max)}
        {lineHover?.bandId === "tokens" &&
          crosshair(band, lineHover, styles.hoverDotTokens)}
        {lineHitRect(band, (event) => {
          const { px, t } = cursorTime(event);
          const value = tokenValueAt(t);
          setLineHover({
            bandId: "tokens",
            x: px,
            dotY: y(value),
            top: band.top + kPlotTop,
            label: `${value.toLocaleString()} tokens · ${fmtTimeSec(t)}`,
          });
        })}
      </g>
    );
  };

  // ── CONTEXT SIZE ──────────────────────────────────────────────────────

  const renderContext = (band: Band) => {
    const dropMax = data.compactions.reduce(
      (m, c) => Math.max(m, c.before ?? 0),
      0
    );
    const max = Math.max(data.contextPeak, dropMax, 1);
    const yMax = max * 1.05;
    const y = (v: number): number =>
      band.top + kPlotBottom - (v / yMax) * (kPlotBottom - kPlotTop);

    // Split the polyline at compaction drops so the line doesn't slope
    // through the cliff — each drop restarts the run at tokens_after.
    const runs: { x: number; y: number }[][] = [];
    let run: { x: number; y: number }[] = [];
    let compactionIndex = 0;
    for (const point of data.contextSeries) {
      while (
        compactionIndex < data.compactions.length &&
        (data.compactions[compactionIndex]?.time ?? Infinity) <= point.time
      ) {
        const drop = data.compactions[compactionIndex]!;
        if (run.length > 0) runs.push(run);
        run =
          drop.after !== undefined
            ? [{ x: x(drop.time), y: y(drop.after) }]
            : [];
        compactionIndex += 1;
      }
      run.push({ x: x(point.time), y: y(point.value) });
    }
    if (run.length > 0) runs.push(run);

    // Dots only at sparse density — they'd smear into a rope at scale.
    const sparse = data.contextSeries.length <= plotWidth / 8;

    return (
      <g key="band-context">
        {bandLabel(band, "CONTEXT SIZE")}
        {bandHeadline(band, `peak ${fmtTokens(data.contextPeak)}`)}
        {runs.map((points, i) => (
          <polyline
            key={`ctx-run-${i}`}
            className={styles.contextSeries}
            points={points
              .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
              .join(" ")}
          />
        ))}
        {sparse &&
          data.contextSeries.map((point, i) => (
            <circle
              key={`ctx-dot-${i}`}
              className={styles.contextDot}
              cx={x(point.time)}
              cy={y(point.value)}
              r={2}
            />
          ))}
        {(() => {
          // Every drop draws its dashed cliff, but annotations declutter:
          // a label only renders with enough horizontal room after the
          // previously labeled drop (same philosophy as the N-longest
          // stall labels) — dense compaction runs stay readable.
          let lastLabelX = -Infinity;
          return data.compactions.map((drop, i) => {
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
        {lineHover?.bandId === "context" &&
          crosshair(band, lineHover, styles.hoverDotContext)}
        {lineHitRect(band, (event) => {
          const { px, t } = cursorTime(event);
          // Nearest point at or before the cursor.
          let value = 0;
          for (const point of data.contextSeries) {
            if (point.time > t) break;
            value = point.value;
          }
          setLineHover({
            bandId: "context",
            x: px,
            dotY: y(value),
            top: band.top + kPlotTop,
            label: `${value.toLocaleString()} tokens · ${fmtTimeSec(t)}`,
          });
        })}
      </g>
    );
  };

  // ── MODEL & TOOL ACTIVITY ─────────────────────────────────────────────

  const spanWidth = (s: ActivitySpan): number =>
    Math.max(x(s.end) - x(s.start), 1.5);

  /** The row label's full text ("model · grader" / "model + tools") — the
   *  burst-label declutter reserves its extent. */
  const rowLabelText = (row: AgentRow): string =>
    `${row.model} ${row.role ? `· ${row.role}` : row.toolCount > 0 ? "+ tools" : ""}`;

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
        {row.spans.map((s, i) => {
          const subLaned = s.subLane !== undefined;
          const h = subLaned ? kSubLaneHeight : kAgentSpanHeight;
          const failedTool = s.kind === "tool" && s.failed;
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
                  s.uuid && onOpenEvent && styles.clickableSpan
                )}
                x={x(s.start)}
                y={laneY(s)}
                width={spanWidth(s)}
                height={h}
                rx={1}
                onMouseEnter={() =>
                  setSpanHover({ x: x(s.start), span: s, row })
                }
                onMouseLeave={() => setSpanHover(null)}
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
          // hover popover keeps the full detail for unlabeled bursts.
          let lastLabelEnd =
            kYAxisWidth + 4 + rowLabelText(row).length * 5 + 12;
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

  const renderDenseRow = (
    row: AgentRow,
    rowTop: number,
    band: Band
  ): ReactNode => {
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
            const { px } = cursorTime(event);
            const bin = binAt(px);
            setBinHover({
              x: px,
              top: band.top + kPlotTop,
              label: bin.label,
              window: bin.window,
            });
          }}
          onMouseLeave={() => setBinHover(null)}
          onClick={
            onFilterWindow
              ? (event) => {
                  const { px } = cursorTime(event);
                  onFilterWindow(binAt(px).window);
                }
              : undefined
          }
        />
      </Fragment>
    );
  };

  const renderModelTool = (band: Band) => {
    const totalSpans = data.agentRows.reduce(
      (sum, row) => sum + row.spans.length,
      0
    );
    const totalTools = data.agentRows.reduce(
      (sum, row) => sum + row.toolCount,
      0
    );
    const totalModels = totalSpans - totalTools;
    const anyDense = data.agentRows.some(
      (row) => row.spans.length > plotWidth / kDensityPxPerSpan
    );
    return (
      <g key="band-model-tool">
        {bandLabel(band, "MODEL & TOOL ACTIVITY")}
        {bandHeadline(
          band,
          anyDense
            ? `${totalModels.toLocaleString()} model · ${totalTools.toLocaleString()} tool · per-pixel occupancy`
            : `${totalModels.toLocaleString()} model · ${totalTools.toLocaleString()} tool`
        )}
        {data.agentRows.map((row, i) => {
          const rowTop = band.top + kAgentRowFirstLabelY + i * kAgentRowPitch;
          const dense = row.spans.length > plotWidth / kDensityPxPerSpan;
          return (
            <g
              key={`row-${row.model}-${row.role ?? ""}`}
              className={row.role ? styles.roleRow : undefined}
            >
              <text className={styles.rowLabel} x={kYAxisWidth + 4} y={rowTop}>
                {row.model}{" "}
                <tspan className={styles.rowLabelMuted}>
                  {rowLabelText(row).slice(row.model.length + 1)}
                </tspan>
              </text>
              {dense
                ? renderDenseRow(row, rowTop, band)
                : renderDiscreteRow(row, rowTop)}
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
            setMarkerHover({ x: group.x, members: group.members });
            onHoverMarker?.(keys);
          };
          const deactivate = () => {
            setMarkerHover(null);
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

  // ── popovers / tooltips ───────────────────────────────────────────────

  const renderSpanPopover = () => {
    if (!spanHover) return null;
    const { span: s, row } = spanHover;
    const left = Math.min(
      Math.max(spanHover.x - 24, 0),
      Math.max(width - 300, 0)
    );
    // Find the band top for model/tool to anchor below the hovered row.
    const band = bands.find((b) => b.kind === "modelTool");
    const rowIndex = data.agentRows.indexOf(row);
    const top =
      (band?.top ?? 0) +
      kAgentSpanOffset +
      Math.max(rowIndex, 0) * kAgentRowPitch +
      kAgentSpanHeight +
      4;
    return (
      <div className={styles.spanPopover} style={{ left, top }}>
        <div className={styles.spanPopoverHeader}>
          <span
            className={styles.spanPopoverSwatch}
            style={{ background: s.kind === "model" ? "#64748b" : "#4f8f8b" }}
          />
          <span className={styles.spanPopoverTitle}>{s.label}</span>
          <span className={styles.spanPopoverTime}>
            {fmtTimeSec(s.start)}
            {s.end > s.start
              ? ` – ${s.pending ? "now" : fmtTimeSec(s.end)}`
              : ""}
          </span>
        </div>
        <div className={styles.spanPopoverBody}>
          {s.kind === "model" ? "model call" : "tool call"}
          {row.role ? ` · ${row.role}` : ""}
          {` · ${fmtDurationWords(s.end - s.start)}`}
          {s.retries !== undefined && s.retries > 0
            ? ` · retried ×${s.retries}`
            : ""}
          {s.failed ? (
            <span className={styles.spanPopoverFailed}> · failed</span>
          ) : (
            ""
          )}
          {s.uuid && onOpenEvent ? (
            <span className={styles.spanPopoverHint}>
              {" "}
              · click to open in transcript
            </span>
          ) : null}
        </div>
      </div>
    );
  };

  const renderMarkerPopover = () => {
    if (!markerHover) return null;
    const left = Math.min(
      Math.max(markerHover.x - 24, 0),
      Math.max(width - 300, 0)
    );
    return (
      <div
        className={styles.markerPopover}
        style={{ left, top: markerHeadroom + 8 }}
      >
        {markerHover.members.map((member, i) => (
          <div key={i} className={styles.markerPopoverEntry}>
            <span
              className={styles.markerPopoverSwatch}
              style={{ background: kCategoryColor[member.category] }}
            />
            <span>{member.label}</span>
            <span className={styles.markerPopoverTime}>
              {fmtTimeSec(member.time)}
            </span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div ref={chartRef} className={styles.chart} style={{ height }}>
      {width > 0 && (
        <svg className={styles.svg} width={width} height={height}>
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
          {showMarkers && renderMarkers()}
        </svg>
      )}
      {renderSpanPopover()}
      {renderMarkerPopover()}
      {(lineHover ?? binHover) && (
        <div
          className={styles.lineTooltip}
          style={(() => {
            const hover = lineHover ?? binHover!;
            return hover.x > width - 180
              ? {
                  left: hover.x - 10,
                  top: hover.top,
                  transform: "translateX(-100%)",
                }
              : { left: hover.x + 10, top: hover.top };
          })()}
        >
          {(lineHover ?? binHover!).label}
        </div>
      )}
    </div>
  );
};
