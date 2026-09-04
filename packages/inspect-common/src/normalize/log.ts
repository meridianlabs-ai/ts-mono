import { isRecord } from "@tsmono/util";

import type {
  ConfigUpdate,
  ConnectionLimitChange,
  EvalMetric,
  EvalPlan,
  EvalResults,
  EvalScore,
  EvalSpec,
  EvalStats,
} from "../types";

import { normalizeModelUsageMap } from "./summary";

/**
 * Normalize a raw EvalSpec: apply the same legacy migrations as pydantic's
 * `EvalSpec.read_sandbox_spec` / `migrate_values`, then fill fields the
 * models default at read time.
 */
export const normalizeEvalSpec = (raw: unknown): EvalSpec => {
  if (!isRecord(raw)) {
    throw new Error("Invalid eval spec: expected an object");
  }
  const spec: Record<string, unknown> = { ...raw };

  // Legacy migration: sandbox was serialized as a [type, config] tuple.
  const sandbox: unknown = spec["sandbox"];
  if (Array.isArray(sandbox)) {
    const [type, config] = sandbox as unknown[];
    spec["sandbox"] = { type, config };
  }
  // `*_args_passed` postdate `*_args`; older logs carry only the resolved args.
  spec["task_args"] ??= {};
  spec["task_args_passed"] ??= spec["task_args"];
  spec["solver_args_passed"] ??= spec["solver_args"] ?? null;

  for (const field of ["task", "task_id", "run_id", "model", "created"]) {
    if (typeof spec[field] !== "string") spec[field] = "";
  }
  // Python synthesizes eval_id as a hash of run_id + task_id + created for
  // pre-eval_id logs; use the same inputs (unhashed) so it is equally stable.
  if (typeof spec["eval_id"] !== "string") {
    spec["eval_id"] =
      `${String(spec["run_id"])}-${String(spec["task_id"])}-${String(spec["created"])}`;
  }
  spec["task_version"] ??= 0;
  for (const field of [
    "task_attribs",
    "model_args",
    "model_generate_config",
    "packages",
    "config",
    "dataset",
  ]) {
    if (!isRecord(spec[field])) spec[field] = {};
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary lift (#555): required fields are filled above; the rest is wire data TypeScript can't verify
  return spec as unknown as EvalSpec;
};

/** Normalize a raw EvalPlan, mirroring pydantic's field defaults. */
export const normalizeEvalPlan = (raw: unknown): EvalPlan => {
  const plan: Record<string, unknown> = isRecord(raw) ? { ...raw } : {};
  if (typeof plan["name"] !== "string") plan["name"] = "plan";
  if (!Array.isArray(plan["steps"])) plan["steps"] = [];
  if (!isRecord(plan["config"])) plan["config"] = {};
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary lift (#555): required fields are filled above; the rest is wire data TypeScript can't verify
  return plan as unknown as EvalPlan;
};

const isEvalMetric = (value: unknown): value is EvalMetric =>
  isRecord(value) &&
  typeof value["name"] === "string" &&
  typeof value["value"] === "number" &&
  isRecord(value["params"]);

const isEvalMetricMap = (value: unknown): value is Record<string, EvalMetric> =>
  isRecord(value) && Object.values(value).every(isEvalMetric);

// Metrics are keyed by name in the map, so a missing name fills from the key;
// `params` postdates `options` (the 2024 shape) and defaults to {} upstream.
const normalizeEvalMetrics = (raw: unknown): Record<string, EvalMetric> => {
  if (!isRecord(raw)) {
    return {};
  }
  if (isEvalMetricMap(raw)) {
    return raw;
  }
  const metrics: Record<string, EvalMetric> = {};
  for (const [name, entry] of Object.entries(raw)) {
    if (!isRecord(entry)) continue;
    const filled = {
      ...entry,
      name: typeof entry["name"] === "string" ? entry["name"] : name,
      params: isRecord(entry["params"]) ? entry["params"] : {},
    };
    if (isEvalMetric(filled)) metrics[name] = filled;
  }
  return metrics;
};

const isEvalScore = (value: unknown): value is EvalScore =>
  isRecord(value) &&
  typeof value["name"] === "string" &&
  typeof value["scorer"] === "string" &&
  isRecord(value["metrics"]) &&
  isRecord(value["params"]);

/**
 * Normalize raw per-scorer results. Entries without a name drop (pydantic
 * has no default); `scorer` predates multi-scorer logs and backfills from
 * the name, as the v1 migration does; `metrics`/`params` default to {}.
 */
const normalizeEvalScores = (raw: unknown): EvalScore[] => {
  if (!Array.isArray(raw)) {
    return [];
  }
  const entries = raw as unknown[];
  const scores: EvalScore[] = [];
  for (const entry of entries) {
    if (!isRecord(entry) || typeof entry["name"] !== "string") continue;
    const filled = {
      ...entry,
      scorer:
        typeof entry["scorer"] === "string" ? entry["scorer"] : entry["name"],
      metrics: normalizeEvalMetrics(entry["metrics"]),
      params: isRecord(entry["params"]) ? entry["params"] : {},
    };
    if (isEvalScore(filled)) scores.push(filled);
  }
  return scores;
};

const kLimitChangeReasons: ReadonlySet<unknown> = new Set([
  "slow_start",
  "steady_state_up",
  "rate_limit",
  "manual",
]);

const isConnectionLimitChange = (
  value: unknown
): value is ConnectionLimitChange =>
  isRecord(value) &&
  typeof value["model"] === "string" &&
  typeof value["new_limit"] === "number" &&
  typeof value["old_limit"] === "number" &&
  kLimitChangeReasons.has(value["reason"]) &&
  typeof value["timestamp"] === "number";

/**
 * Normalize raw EvalStats, mirroring pydantic's field defaults. Usage
 * entries are filled inside the maps (their token fields are read unguarded
 * by the tokens column). Absent or non-object stats stay absent: journal
 * headers legitimately carry none.
 */
export const normalizeEvalStats = (raw: unknown): EvalStats | undefined => {
  if (!isRecord(raw)) {
    return undefined;
  }
  const history = raw["connection_limit_history"];
  return {
    ...raw,
    started_at: typeof raw["started_at"] === "string" ? raw["started_at"] : "",
    completed_at:
      typeof raw["completed_at"] === "string" ? raw["completed_at"] : "",
    model_usage: normalizeModelUsageMap(raw["model_usage"]),
    role_usage: normalizeModelUsageMap(raw["role_usage"]),
    // Limit changes have no pydantic defaults, so malformed entries drop.
    connection_limit_history: Array.isArray(history)
      ? (history as unknown[]).filter(isConnectionLimitChange)
      : [],
  };
};

/**
 * Normalize raw EvalResults. Returns null for absent results (in-progress
 * logs legitimately have none).
 */
export const normalizeEvalResults = (raw: unknown): EvalResults | null => {
  if (!isRecord(raw)) {
    return null;
  }
  const results: Record<string, unknown> = { ...raw };
  if (typeof results["total_samples"] !== "number")
    results["total_samples"] = 0;
  if (typeof results["completed_samples"] !== "number")
    results["completed_samples"] = 0;
  results["scores"] = normalizeEvalScores(results["scores"]);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary lift (#555): required fields are filled above; the rest is wire data TypeScript can't verify
  return results as unknown as EvalResults;
};

/**
 * Normalize raw journal/header config updates. Entries whose `changes`
 * isn't an array are dropped (a malformed entry degrades to a skip instead
 * of failing the whole header read); non-object change rows are dropped;
 * per-change and provenance fields the type requires are filled.
 */
export const normalizeConfigUpdates = (raw: unknown): ConfigUpdate[] => {
  if (!Array.isArray(raw)) {
    return [];
  }
  const updates: ConfigUpdate[] = [];
  for (const entry of raw) {
    if (!isRecord(entry) || !Array.isArray(entry["changes"])) {
      continue;
    }
    const changes: Record<string, unknown>[] = [];
    for (const change of entry["changes"]) {
      if (!isRecord(change) || typeof change["name"] !== "string") {
        continue;
      }
      const fixed = { ...change };
      if (typeof fixed["cleared"] !== "boolean") fixed["cleared"] = false;
      if (fixed["value"] === undefined) fixed["value"] = null;
      if (fixed["previous"] === undefined) fixed["previous"] = null;
      changes.push(fixed);
    }
    const provenance: Record<string, unknown> = isRecord(entry["provenance"])
      ? { ...entry["provenance"] }
      : {};
    if (typeof provenance["timestamp"] !== "string")
      provenance["timestamp"] = "";
    if (typeof provenance["author"] !== "string") provenance["author"] = "";
    if (!isRecord(provenance["metadata"])) provenance["metadata"] = {};
    const update = {
      ...entry,
      changes,
      provenance,
      scope: entry["scope"] === "process" ? "process" : "task",
    };
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary lift (#555): required fields are filled above; the rest is wire data TypeScript can't verify
    updates.push(update as unknown as ConfigUpdate);
  }
  return updates;
};
