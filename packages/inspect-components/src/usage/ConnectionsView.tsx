import clsx from "clsx";
import { FC, Fragment, MouseEvent, useCallback, useState } from "react";

import { useResizeObserver } from "@tsmono/react/hooks";

import {
  buildStepPath,
  capGuideSegments,
  type ConnectionLaneData,
  type ConnectionWindow,
  laneCapValues,
  type PoolRetune,
  retuneTransition,
} from "./connectionHistory";
import styles from "./ConnectionsView.module.css";
import { rolesForModel } from "./roleAliases";

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
    rolesForModel(role_aliases, model);

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
  const capValues = laneCapValues(data, retunes, timeWindow.end);
  const yMax =
    Math.max(data.configuredMax ?? 0, data.peak, ...capValues) * 1.08 || 1;
  const x = (t: number): number => {
    const clamped = Math.min(Math.max(t, timeWindow.start), timeWindow.end);
    return span > 0 ? ((clamped - timeWindow.start) / span) * width : 0;
  };
  const y = (v: number): number =>
    kBaselineY - (v / yMax) * (kBaselineY - kPlotTop);

  const path = buildStepPath(data, timeWindow.start, x, y, width);

  // The cap guide steps at the ◆ that changed it.
  const capSegments = capGuideSegments(
    data,
    retunes,
    timeWindow.end,
    x,
    0,
    width
  );

  const finalY = y(data.final);
  const peakAndFinalMerge = data.peak === data.final;
  // A pool that only scaled down peaks at its start — merge those labels
  // too, or "peak N" prints directly over "start N" at x=0.
  const startAndPeakMerge = !peakAndFinalMerge && data.start === data.peak;
  // Where the series first reaches its peak — the plateau the label sits on.
  let peakX = 0;
  if (data.start !== data.peak) {
    for (const e of data.events) {
      if (e.new_limit === data.peak) {
        peakX = x(e.timestamp);
        break;
      }
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
                  <title>{`${retuneTransition(retune)} · ${retune.author}${retune.reason ? ` — ${retune.reason}` : ""}`}</title>
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
            {startAndPeakMerge
              ? `start · peak ${data.start}`
              : `start ${data.start}`}
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
              {!startAndPeakMerge && (
                <text
                  className={styles.chartLabel}
                  x={Math.min(peakX + 4, width - 40)}
                  y={y(data.peak) - 4}
                >
                  peak {data.peak}
                </text>
              )}
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
