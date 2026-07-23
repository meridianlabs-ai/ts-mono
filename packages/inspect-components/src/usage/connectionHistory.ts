import type {
  AdaptiveConcurrency,
  ConfigUpdate,
  ConnectionLimitChange,
} from "@tsmono/inspect-common/types";
import { isoToEpoch } from "@tsmono/inspect-common/utils";

import { formatConfigValue } from "../config";

export interface ConnectionWindow {
  start: number;
  end: number;
}

export interface ConnectionLaneData {
  model: string;
  events: ConnectionLimitChange[];
  start: number;
  peak: number;
  final: number;
  avg: number;
  rateLimitCount: number;
  configuredMax?: number;
}

const kAdaptiveDefaultMax = 100;

// History timestamps are epoch seconds while started_at/completed_at are ISO
// strings; normalize here. The window expands to cover any events outside the
// eval bounds (clock skew, live evals with no completed_at yet).
export const connectionWindow = (
  history: ConnectionLimitChange[] | undefined,
  startedAt?: string | null,
  completedAt?: string | null
): ConnectionWindow | undefined => {
  if (!history || history.length === 0) return undefined;
  let first = Infinity;
  let last = -Infinity;
  for (const e of history) {
    if (e.timestamp < first) first = e.timestamp;
    if (e.timestamp > last) last = e.timestamp;
  }
  const start = Math.min(isoToEpoch(startedAt) ?? first, first);
  const end = Math.max(isoToEpoch(completedAt) ?? last, last);
  return { start, end };
};

// adaptive_connections is boolean | number | AdaptiveConcurrency | null, plus
// the "min-max" / "min-start-max" string shorthand accepted by CLI flags.
export const adaptiveMaxFromValue = (adaptive: unknown): number | undefined => {
  if (adaptive == null || adaptive === false) return undefined;
  if (adaptive === true) return kAdaptiveDefaultMax;
  if (typeof adaptive === "number") return adaptive;
  if (typeof adaptive === "string") {
    const parts = adaptive.split("-");
    const max = Number(parts[parts.length - 1]);
    return Number.isFinite(max) ? max : kAdaptiveDefaultMax;
  }
  if (typeof adaptive === "object") {
    const max = (adaptive as Partial<AdaptiveConcurrency>).max;
    return typeof max === "number" ? max : kAdaptiveDefaultMax;
  }
  return undefined;
};

export const adaptiveMaxFromConfig = (
  config?: Record<string, unknown>
): number | undefined => adaptiveMaxFromValue(config?.["adaptive_connections"]);

/** A mid-run config change that retuned a model's connection pool. */
export interface PoolRetune {
  /** Epoch seconds (provenance timestamps are ISO strings). */
  timestamp: number;
  /** The knob: max_connections / adaptive_connections / the registry key. */
  name: string;
  previous: unknown;
  /** Value set by the change — null when cleared (check `cleared` first). */
  value: unknown;
  /** Override removed — the pool reverted to its launch cap. */
  cleared: boolean;
  author: string;
  reason?: string | null;
}

/**
 * The cap a retune steps the guide to: a number, `"none"` when the cap
 * ceases to exist (adaptive disabled, limit nulled, or cleared with no
 * launch cap to restore), or undefined when the retune doesn't step the
 * cap at all. A cleared retune restores `launchCap` (the guide's starting
 * value — the closest launch signal a lane carries).
 */
export const capFromRetune = (
  retune: PoolRetune,
  launchCap?: number
): number | "none" | undefined => {
  if (retune.cleared) {
    return launchCap ?? "none";
  }
  if (retune.name === "adaptive_connections") {
    return adaptiveMaxFromValue(retune.value) ?? "none";
  }
  if (typeof retune.value === "number") {
    return retune.value;
  }
  return retune.value === null ? "none" : undefined;
};

/** The transition text shared by lane ◆ tooltips and Connection Log rows. */
export const retuneTransition = (retune: PoolRetune): string =>
  retune.cleared
    ? `${retune.name} override cleared → launch value`
    : `${retune.name} ${formatConfigValue(retune.previous)} → ${formatConfigValue(retune.value)}`;

/**
 * Per-model pool retunes from config_updates: `"concurrency"` changes key
 * on the registry name; generate max_connections / adaptive_connections
 * changes apply to the main model's pool.
 */
export const poolRetunes = (
  updates: ConfigUpdate[] | null | undefined,
  mainModel?: string
): Record<string, PoolRetune[]> => {
  const byModel: Record<string, PoolRetune[]> = {};
  for (const update of updates ?? []) {
    const timestamp = isoToEpoch(update.provenance.timestamp);
    if (timestamp === undefined) continue;
    for (const change of update.changes) {
      const model =
        change.config === "concurrency"
          ? change.name
          : change.config === "generate" &&
              (change.name === "max_connections" ||
                change.name === "adaptive_connections")
            ? mainModel
            : undefined;
      if (!model) continue;
      (byModel[model] ??= []).push({
        timestamp,
        name: change.name,
        previous: change.previous,
        value: change.value,
        cleared: change.cleared,
        author: update.provenance.author,
        reason: update.provenance.reason,
      });
    }
  }
  for (const retunes of Object.values(byModel)) {
    retunes.sort((a, b) => a.timestamp - b.timestamp);
  }
  return byModel;
};

export const buildConnectionLanes = (
  history: ConnectionLimitChange[] | undefined,
  window: ConnectionWindow | undefined,
  configuredMax?: (model: string) => number | undefined
): Record<string, ConnectionLaneData> => {
  const lanes: Record<string, ConnectionLaneData> = {};
  if (!history || history.length === 0 || !window) return lanes;

  const byModel: Record<string, ConnectionLimitChange[]> = {};
  for (const e of history) (byModel[e.model] ??= []).push(e);

  for (const [model, events] of Object.entries(byModel)) {
    events.sort((a, b) => a.timestamp - b.timestamp);
    const start = events[0]!.old_limit;
    const final = events[events.length - 1]!.new_limit;

    let peak = start;
    let rateLimitCount = 0;
    for (const e of events) {
      peak = Math.max(peak, e.old_limit, e.new_limit);
      if (e.reason === "rate_limit") rateLimitCount += 1;
    }

    // Time-weighted average: the limit between entries is the previous
    // new_limit, extended to the window edges on both sides.
    let weighted = 0;
    let prevT = window.start;
    let prevV = start;
    for (const e of events) {
      const t = Math.min(Math.max(e.timestamp, window.start), window.end);
      weighted += prevV * (t - prevT);
      prevT = t;
      prevV = e.new_limit;
    }
    weighted += prevV * (window.end - prevT);
    const span = window.end - window.start;
    const avg = span > 0 ? weighted / span : final;

    lanes[model] = {
      model,
      events,
      start,
      peak,
      final,
      avg,
      rateLimitCount,
      configuredMax: configuredMax?.(model),
    };
  }
  return lanes;
};

/**
 * SVG path for a lane's stepped connections series. `x`/`y` map time/value
 * into pixel space; `rightEdge` extends the final value to the plot edge.
 */
export const buildStepPath = (
  lane: ConnectionLaneData,
  windowStart: number,
  x: (t: number) => number,
  y: (v: number) => number,
  rightEdge: number
): string => {
  let path = `M ${x(windowStart)} ${y(lane.start)}`;
  let prev = lane.start;
  for (const e of lane.events) {
    const ex = x(e.timestamp);
    path += ` L ${ex} ${y(prev)} L ${ex} ${y(e.new_limit)}`;
    prev = e.new_limit;
  }
  path += ` L ${rightEdge} ${y(prev)}`;
  return path;
};

export interface CapSegment {
  x1: number;
  x2: number;
  value: number;
}

/**
 * Cap-guide segments stepping at the ◆ that changed the cap. Retunes after
 * `windowEnd` (post-run amendments) never step the guide, and a `"none"`
 * step ends it until a later retune restores a cap.
 */
export const capGuideSegments = (
  lane: ConnectionLaneData,
  retunes: PoolRetune[] | undefined,
  windowEnd: number,
  x: (t: number) => number,
  leftEdge: number,
  rightEdge: number
): CapSegment[] => {
  const segments: CapSegment[] = [];
  let capValue = lane.configuredMax;
  let capStart = leftEdge;
  for (const retune of retunes ?? []) {
    if (retune.timestamp > windowEnd) continue;
    const next = capFromRetune(retune, lane.configuredMax);
    if (next === undefined) continue;
    const rx = x(retune.timestamp);
    if (capValue !== undefined && rx > capStart) {
      segments.push({ x1: capStart, x2: rx, value: capValue });
    }
    capValue = next === "none" ? undefined : next;
    capStart = rx;
  }
  if (capValue !== undefined) {
    segments.push({ x1: capStart, x2: rightEdge, value: capValue });
  }
  return segments;
};

/** Caps the guide can show in-window — the y-scale must cover them. */
export const laneCapValues = (
  lane: ConnectionLaneData,
  retunes: PoolRetune[] | undefined,
  windowEnd: number
): number[] =>
  (retunes ?? [])
    .filter((retune) => retune.timestamp <= windowEnd)
    .map((retune) => capFromRetune(retune, lane.configuredMax))
    .filter((v): v is number => typeof v === "number");
