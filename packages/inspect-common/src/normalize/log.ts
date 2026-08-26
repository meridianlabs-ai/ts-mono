import { isRecord } from "@tsmono/util";

import type { ConfigUpdate, EvalPlan, EvalResults, EvalSpec } from "../types";

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
  if (!Array.isArray(results["scores"])) results["scores"] = [];
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
