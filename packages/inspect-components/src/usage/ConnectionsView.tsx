import clsx from "clsx";
import { FC, Fragment, MouseEvent, useCallback, useState } from "react";

import { useResizeObserver } from "@tsmono/react/hooks";

import {
  adaptiveMaxFromValue,
  type ConnectionLaneData,
  type ConnectionWindow,
  type PoolRetune,
} from "./connectionHistory";
import styles from "./ConnectionsView.module.css";

interface ConnectionsViewProps {
  lanes: Record<string, ConnectionLaneData>;
  timeWindow: ConnectionWindow;
  role_aliases?: Record<string, string>;
  retunes_by_model?: Record<string, PoolRetune[]>;
  onShowLog?: (model: string) => void;
  onViewTimeline?: (
    model: string,
    event: MouseEvent<HTMLButtonElement>
  ) => void;
}

/** The legend for the Connections view header row (◆ / rate limit / max). */
export const ConnectionsLegend: FC = () => (
  <span className={styles.legend}>
    <span className={styles.legendItem}>
      <span className={styles.legendDiamond} />
      config change
    </span>
    <span className={styles.legendItem}>
      <span className={styles.legendRateLimit} />
      rate limit
    </span>
    <span className={styles.legendItem}>
      <span className={styles.legendGuide} />
      adaptive max
    </span>
  </span>
);

/**
 * The Usage table's Connections lens: one row per connection pool (pools
 * are model-keyed — roles sharing a model render once, listed as chips).
 */
export const ConnectionsView: FC<ConnectionsViewProps> = ({
  lanes,
  timeWindow,
  role_aliases,
  retunes_by_model,
  onShowLog,
  onViewTimeline,
}) => {
  const models = Object.keys(lanes).sort();
  if (models.length === 0) return null;

  const rolesFor = (model: string): string[] =>
    Object.entries(role_aliases ?? {})
      .filter(([, m]) => m === model)
      .map(([role]) => role);

  return (
    <div className={styles.grid}>
      <div className={styles.headCell}>Model</div>
      <div className={styles.headCell}>Average</div>
      <div className={styles.headCell}>Connections over time</div>
      <div className={styles.headCell} />
      {models.map((model, index) => {
        const lane = lanes[model]!;
        const roles = rolesFor(model);
        const last = index === models.length - 1;
        const cellClass = clsx(styles.cell, last && styles.lastRow);
        return (
          <Fragment key={model}>
            <div className={clsx(cellClass, styles.modelCell)}>
              <span className={styles.modelName}>{model}</span>
              {roles.length > 0 && (
                <span className={styles.roles}>
                  {roles.length > 1 ? "shared by" : "used by"}
                  {roles.map((role) => (
                    <span key={role} className={styles.roleChip}>
                      {role}
                    </span>
                  ))}
                </span>
              )}
            </div>
            <div className={clsx(cellClass, styles.avgCell)}>
              <span className={styles.avgValue}>
                {Math.round(lane.avg)}
                <small>avg</small>
              </span>
              {lane.rateLimitCount > 0 && (
                <span className={styles.rateLimits}>
                  {lane.rateLimitCount} rate limit
                  {lane.rateLimitCount === 1 ? "" : "s"}
                </span>
              )}
            </div>
            <div className={cellClass}>
              <PoolLane
                data={lane}
                timeWindow={timeWindow}
                retunes={retunes_by_model?.[model]}
                onShowLog={onShowLog ? () => onShowLog(model) : undefined}
              />
            </div>
            <div className={clsx(cellClass, styles.actionsCell)}>
              {onShowLog && (
                <button
                  type="button"
                  className={styles.actionLink}
                  title="Connection log"
                  onClick={() => onShowLog(model)}
                >
                  <i className="bi bi-clock-history" aria-hidden="true" />
                  Log
                </button>
              )}
              {onViewTimeline && (
                <button
                  type="button"
                  className={styles.actionLink}
                  title="View on timeline"
                  onClick={(event) => onViewTimeline(model, event)}
                >
                  <i className="bi bi-graph-up" aria-hidden="true" />
                  Timeline
                </button>
              )}
            </div>
          </Fragment>
        );
      })}
    </div>
  );
};

const kChartHeight = 78;
const kPlotTop = 14;
const kMarkerTop = 10;
const kBaselineY = 60;

interface PoolLaneProps {
  data: ConnectionLaneData;
  timeWindow: ConnectionWindow;
  retunes?: PoolRetune[];
  onShowLog?: () => void;
}

const capFromRetune = (retune: PoolRetune): number | undefined => {
  if (retune.name === "adaptive_connections") {
    return adaptiveMaxFromValue(retune.value);
  }
  return typeof retune.value === "number" ? retune.value : undefined;
};

/**
 * The 27a annotated pool lane: blue stepped series, violet cap guide
 * stepping at ◆ retunes, red rate-limit hairlines, start/peak/final labels
 * riding the line. Every mark is a Connection Log row — clicking opens it.
 */
const PoolLane: FC<PoolLaneProps> = ({
  data,
  timeWindow,
  retunes,
  onShowLog,
}) => {
  const [width, setWidth] = useState(0);
  const chartRef = useResizeObserver(
    useCallback(
      (entry: ResizeObserverEntry) => setWidth(entry.contentRect.width),
      []
    )
  );

  const span = timeWindow.end - timeWindow.start;
  const capValues = (retunes ?? [])
    .map(capFromRetune)
    .filter((v): v is number => v !== undefined);
  const yMax =
    Math.max(data.configuredMax ?? 0, data.peak, ...capValues) * 1.08 || 1;
  const x = (t: number): number => {
    const clamped = Math.min(Math.max(t, timeWindow.start), timeWindow.end);
    return span > 0 ? ((clamped - timeWindow.start) / span) * width : 0;
  };
  const y = (v: number): number =>
    kBaselineY - (v / yMax) * (kBaselineY - kPlotTop);

  let path = `M ${x(timeWindow.start)} ${y(data.start)}`;
  let prev = data.start;
  for (const e of data.events) {
    const ex = x(e.timestamp);
    path += ` L ${ex} ${y(prev)} L ${ex} ${y(e.new_limit)}`;
    prev = e.new_limit;
  }
  path += ` L ${width} ${y(prev)}`;

  // The cap guide steps at the ◆ that changed it.
  const capSegments: { x1: number; x2: number; value: number }[] = [];
  let capValue = data.configuredMax;
  let capStart = 0;
  for (const retune of retunes ?? []) {
    const next = capFromRetune(retune);
    if (next === undefined) continue;
    const rx = x(retune.timestamp);
    if (capValue !== undefined && rx > capStart) {
      capSegments.push({ x1: capStart, x2: rx, value: capValue });
    }
    capValue = next;
    capStart = rx;
  }
  if (capValue !== undefined) {
    capSegments.push({ x1: capStart, x2: width, value: capValue });
  }

  const finalY = y(data.final);
  const peakAndFinalMerge = data.peak === data.final;
  // Where the series first reaches its peak — the plateau the label sits on.
  let peakX = 0;
  let running = data.start;
  if (running === data.peak) {
    peakX = 0;
  } else {
    for (const e of data.events) {
      if (e.new_limit === data.peak) {
        peakX = x(e.timestamp);
        break;
      }
      running = e.new_limit;
    }
  }

  return (
    <div ref={chartRef} className={styles.chart}>
      {width > 0 && (
        <svg
          className={styles.svg}
          width={width}
          height={kChartHeight}
          role="img"
          aria-label={`Connections over time for ${data.model}`}
        >
          {capSegments.map((seg, i) => (
            <line
              key={`cap-${i}`}
              className={styles.capGuide}
              x1={seg.x1}
              x2={seg.x2}
              y1={y(seg.value)}
              y2={y(seg.value)}
            />
          ))}
          {data.events
            .filter((e) => e.reason === "rate_limit")
            .map((e, i) => (
              <line
                key={`rl-${i}`}
                className={styles.rateLimitLine}
                x1={x(e.timestamp)}
                x2={x(e.timestamp)}
                y1={kPlotTop}
                y2={kBaselineY}
                onClick={onShowLog}
              >
                <title>{`rate limit · ${e.old_limit} → ${e.new_limit}`}</title>
              </line>
            ))}
          {(retunes ?? []).map((retune, i) => {
            const rx = x(retune.timestamp);
            return (
              <g key={`retune-${i}`} onClick={onShowLog}>
                <line
                  className={styles.retuneLine}
                  x1={rx}
                  x2={rx}
                  y1={kPlotTop}
                  y2={kBaselineY}
                />
                <rect
                  className={styles.retuneMarker}
                  x={rx - 4}
                  y={kMarkerTop - 4}
                  width={8}
                  height={8}
                  transform={`rotate(45 ${rx} ${kMarkerTop})`}
                >
                  <title>{`${retune.name} ${String(retune.previous)} → ${String(retune.value)} · ${retune.author}${retune.reason ? ` — ${retune.reason}` : ""}`}</title>
                </rect>
              </g>
            );
          })}
          <line
            className={styles.baseline}
            x1={0}
            x2={width}
            y1={kBaselineY}
            y2={kBaselineY}
          />
          <path className={styles.series} d={path} />
          <text className={styles.chartLabel} x={0} y={y(data.start) - 4}>
            start {data.start}
          </text>
          {peakAndFinalMerge ? (
            <text
              className={styles.chartLabel}
              x={width - 4}
              y={finalY - 4}
              textAnchor="end"
            >
              peak · final {data.final}
            </text>
          ) : (
            <Fragment>
              <text
                className={styles.chartLabel}
                x={Math.min(peakX + 4, width - 40)}
                y={y(data.peak) - 4}
              >
                peak {data.peak}
              </text>
              <text
                className={styles.chartLabel}
                x={width - 4}
                y={finalY - 4}
                textAnchor="end"
              >
                final {data.final}
              </text>
            </Fragment>
          )}
        </svg>
      )}
    </div>
  );
};
