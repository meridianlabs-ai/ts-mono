import type {
  AdaptiveConcurrency,
  ConfigUpdate,
  ConnectionLimitChange,
} from "@tsmono/inspect-common/types";

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

const isoToEpoch = (iso?: string | null): number | undefined => {
  if (!iso) return undefined;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms / 1000 : undefined;
};

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
export const adaptiveMaxFromValue = (
  adaptive: unknown
): number | undefined => {
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
 * The cap a retune sets the guide to, or undefined for no step. A cleared
 * retune restores `launchCap` (the guide's starting value — the closest
 * launch signal a lane carries).
 */
export const capFromRetune = (
  retune: PoolRetune,
  launchCap?: number
): number | undefined => {
  if (retune.cleared) {
    return launchCap;
  }
  if (retune.name === "adaptive_connections") {
    return adaptiveMaxFromValue(retune.value);
  }
  return typeof retune.value === "number" ? retune.value : undefined;
};

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
    const timestamp = new Date(update.provenance.timestamp).getTime() / 1000;
    if (!Number.isFinite(timestamp)) continue;
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
