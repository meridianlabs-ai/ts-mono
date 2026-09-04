import { isRecord } from "@tsmono/util";

import type { EvalSampleSummary, ModelFallback, ModelUsage } from "../types";

import { normalizeModelUsage } from "./events";

/**
 * Normalize a raw model-usage map (model name → ModelUsage): token defaults
 * filled per entry, non-record entries dropped, non-record input becomes {}.
 * Identity-preserving on clean input.
 */
export const normalizeModelUsageMap = (
  raw: unknown
): Record<string, ModelUsage> => {
  if (!isRecord(raw)) {
    return {};
  }
  let changed = false;
  const usage: Record<string, ModelUsage> = {};
  for (const [model, entry] of Object.entries(raw)) {
    const normalized = normalizeModelUsage(entry);
    if (normalized === undefined) {
      changed = true;
      continue;
    }
    if (normalized !== entry) changed = true;
    usage[model] = normalized;
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary lift (#555): every entry round-tripped unchanged, so raw already satisfies the type
  return changed ? usage : (raw as Record<string, ModelUsage>);
};

const isModelFallback = (value: unknown): value is ModelFallback =>
  isRecord(value) &&
  typeof value["model"] === "string" &&
  typeof value["fallback_model"] === "string" &&
  typeof value["count"] === "number";

/**
 * Normalize a raw model-fallbacks rollup: `count` defaults to 1 the way
 * pydantic fills it; entries without both model names are dropped (pydantic
 * would refuse them); a non-array becomes null, the "no fallbacks" value.
 * Identity-preserving on clean input.
 */
export const normalizeModelFallbacks = (
  raw: unknown
): ModelFallback[] | null => {
  if (!Array.isArray(raw)) {
    return null;
  }
  const entries = raw as unknown[];
  if (entries.every(isModelFallback)) {
    return entries;
  }
  const fallbacks: ModelFallback[] = [];
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const filled =
      typeof entry["count"] === "number" ? entry : { ...entry, count: 1 };
    if (isModelFallback(filled)) fallbacks.push(filled);
  }
  return fallbacks;
};

/**
 * Normalize one raw sample summary (summaries.json, journal summaries, the
 * pending-samples buffer): fill required-by-type fields that pydantic
 * defaults at read time but old writers omit. Returns undefined for entries
 * that aren't object-shaped at all — callers drop those. Current-format
 * input passes through identity-preserved.
 */
export const normalizeSampleSummary = (
  raw: unknown
): EvalSampleSummary | undefined => {
  if (!isRecord(raw)) {
    return undefined;
  }
  // id/epoch have no pydantic default — a row missing them would refuse to
  // parse upstream, so it drops here rather than passing through as a lie.
  if (typeof raw["id"] !== "string" && typeof raw["id"] !== "number") {
    return undefined;
  }
  if (typeof raw["epoch"] !== "number") {
    return undefined;
  }
  let fixes: Record<string, unknown> | undefined;
  const fix = (field: string, value: unknown) => {
    fixes ??= {};
    fixes[field] = value;
  };

  if (typeof raw["input"] !== "string" && !Array.isArray(raw["input"])) {
    fix("input", "");
  }
  if (typeof raw["target"] !== "string" && !Array.isArray(raw["target"])) {
    fix("target", "");
  }
  if (!isRecord(raw["scores"]) && raw["scores"] !== null) fix("scores", null);
  if (!isRecord(raw["metadata"])) fix("metadata", {});
  // Usage entries carry their own required-with-default token fields, read
  // unguarded by the tokens column — fill inside, not just the map.
  for (const field of ["model_usage", "role_usage"]) {
    const usage = normalizeModelUsageMap(raw[field]);
    if (usage !== raw[field]) fix(field, usage);
  }
  // Deliberate divergence from pydantic's `completed: bool = False`: an
  // absent `completed` means a pre-field-era log whose summaries are all
  // settled, and the viewer has always read absence as completed
  // (`completed === false` takes the running path; `filters.ts` used
  // `?? true`). Live paths (pending-samples buffer, journal rows from
  // current writers) set the field explicitly, so only vintage settled
  // rows hit this fill.
  if (typeof raw["completed"] !== "boolean") fix("completed", true);
  // Absent stays absent (the field is optional); anything present must be a
  // clean rollup or null.
  if (raw["model_fallbacks"] !== undefined && raw["model_fallbacks"] !== null) {
    const fallbacks = normalizeModelFallbacks(raw["model_fallbacks"]);
    if (fallbacks !== raw["model_fallbacks"]) fix("model_fallbacks", fallbacks);
  }

  const summary = fixes ? { ...raw, ...fixes } : raw;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary lift (#555): required fields are filled above; the rest is wire data TypeScript can't verify
  return summary as unknown as EvalSampleSummary;
};

/**
 * Normalize a raw summary array. Non-arrays become empty; non-object
 * entries are dropped. Current-format input passes through
 * identity-preserved — no allocation at all.
 */
export const normalizeSampleSummaries = (raw: unknown): EvalSampleSummary[] => {
  if (!Array.isArray(raw)) {
    return [];
  }
  let changed = false;
  const summaries: EvalSampleSummary[] = [];
  for (const entry of raw as unknown[]) {
    const summary = normalizeSampleSummary(entry);
    if (summary === undefined) {
      changed = true;
    } else {
      if (summary !== entry) changed = true;
      summaries.push(summary);
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary lift (#555): every entry round-tripped through normalizeSampleSummary unchanged, so raw already satisfies the type
  return changed ? summaries : (raw as EvalSampleSummary[]);
};
