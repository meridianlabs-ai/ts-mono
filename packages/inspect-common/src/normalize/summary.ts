import { isRecord } from "@tsmono/util";

import type { EvalSampleSummary } from "../types";

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
  for (const field of ["metadata", "model_usage", "role_usage"]) {
    if (!isRecord(raw[field])) fix(field, {});
  }
  // Deliberate divergence from pydantic's `completed: bool = False`: an
  // absent `completed` means a pre-field-era log whose summaries are all
  // settled, and the viewer has always read absence as completed
  // (`completed === false` takes the running path; `filters.ts` used
  // `?? true`). Live paths (pending-samples buffer, journal rows from
  // current writers) set the field explicitly, so only vintage settled
  // rows hit this fill.
  if (typeof raw["completed"] !== "boolean") fix("completed", true);
  if (Array.isArray(raw["model_fallbacks"])) {
    let changed = false;
    const fallbacks: unknown[] = [];
    for (const fallback of raw["model_fallbacks"] as unknown[]) {
      if (isRecord(fallback) && typeof fallback["count"] !== "number") {
        changed = true;
        fallbacks.push({ ...fallback, count: 1 });
      } else {
        fallbacks.push(fallback);
      }
    }
    if (changed) fix("model_fallbacks", fallbacks);
  }

  const summary = fixes ? { ...raw, ...fixes } : raw;
  // Boundary lift (#555): required fields are filled above; remaining
  // content is wire data TypeScript can't verify.
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
  // Boundary lift (#555): every entry round-tripped through
  // normalizeSampleSummary unchanged, so the original array already
  // satisfies EvalSampleSummary[].
  return changed ? summaries : (raw as EvalSampleSummary[]);
};
