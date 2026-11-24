import {
  normalizeConfigUpdates,
  normalizeEvalPlan,
  normalizeEvalResults,
  normalizeEvalSample,
  normalizeEvalSpec,
  normalizeEvalStats,
} from "@tsmono/inspect-common/normalize";
import {
  ConfigUpdate,
  EvalError,
  LogUpdate,
} from "@tsmono/inspect-common/types";
import { isRecord } from "@tsmono/util";

import { EvalLogStatus } from "../../@types/extraInspect";
import { EvalHeader, LogContents, LogPreview } from "../api/types";
import { LogStart } from "../remote/remoteLogFile";

/**
 * Normalize a raw log header (`header.json` in a `.eval` zip, or the header
 * portion of a whole `.json` log): eval/plan/results run through the shared
 * normalizers; `tags`/`metadata` derive from the spec when absent, mirroring
 * Python's `EvalLog.recompute_tags_and_metadata`.
 */
export const normalizeEvalHeader = (raw: unknown): EvalHeader => {
  if (!isRecord(raw)) {
    throw new Error("Invalid log header: expected an object");
  }
  const evalSpec = normalizeEvalSpec(raw["eval"]);
  /* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- boundary lifts (#555): the pass-through fields below are wire data the normalizers don't cover, and each is optional on EvalHeader so absence stays representable */
  return {
    // Spread first so fields the schema grows later survive parsing (matching
    // normalizeEvalSample/normalizeEvent); normalized fields override below.
    ...raw,
    version: typeof raw["version"] === "number" ? raw["version"] : 2,
    status: (raw["status"] ?? "started") as EvalLogStatus,
    invalidated:
      typeof raw["invalidated"] === "boolean" ? raw["invalidated"] : undefined,
    eval: evalSpec,
    plan: normalizeEvalPlan(raw["plan"]),
    results: normalizeEvalResults(raw["results"]),
    stats: normalizeEvalStats(raw["stats"]),
    error: raw["error"] as EvalError | null | undefined,
    tags: (raw["tags"] ?? evalSpec.tags ?? []) as string[],
    metadata: (raw["metadata"] ?? evalSpec.metadata ?? {}) as Record<
      string,
      unknown
    >,
    log_updates: raw["log_updates"] as LogUpdate[] | null | undefined,
    config_updates:
      raw["config_updates"] == null
        ? undefined
        : normalizeConfigUpdates(raw["config_updates"]),
  };
  /* eslint-enable @typescript-eslint/no-unsafe-type-assertion */
};

const stringOr = (value: unknown, fallback: string): string =>
  typeof value === "string" ? value : fallback;

/**
 * Normalize one `listing.json` entry (pydantic's `LogOverview`). Like
 * `normalizeEvalSpec`, this fills only what the type requires: the required
 * strings ("" when missing, `eval_id` synthesized from run_id/task_id/
 * started_at) and `task_version` (0). Everything else is wire data and passes
 * through untouched: bundles built by older inspect_ai releases predate
 * `model_roles` and `invalidated`, and write with exclude_none, so optional
 * fields are routinely absent and stay absent.
 */
export const normalizeLogPreview = (raw: unknown): LogPreview => {
  if (!isRecord(raw)) {
    throw new Error("Invalid log preview: expected an object");
  }
  const run_id = stringOr(raw["run_id"], "");
  const task_id = stringOr(raw["task_id"], "");
  const started_at = stringOr(raw["started_at"], "");
  const task_version = raw["task_version"];
  return {
    // Spread first so fields the schema grows later survive parsing (matching
    // normalizeEvalHeader); required fields override below.
    ...raw,
    eval_id: stringOr(raw["eval_id"], `${run_id}-${task_id}-${started_at}`),
    run_id,
    task: stringOr(raw["task"], ""),
    task_id,
    task_version:
      typeof task_version === "number" || typeof task_version === "string"
        ? task_version
        : 0,
    model: stringOr(raw["model"], ""),
  };
};

/**
 * Normalize a raw `listing.json` (file name → `LogOverview`). Entries that
 * aren't objects are dropped so one malformed row can't take the listing
 * down; a non-object listing is treated as empty.
 */
export const normalizeLogListing = (
  raw: unknown
): Record<string, LogPreview> => {
  if (!isRecord(raw)) {
    return {};
  }
  const listing: Record<string, LogPreview> = {};
  for (const [file, entry] of Object.entries(raw)) {
    if (isRecord(entry)) listing[file] = normalizeLogPreview(entry);
  }
  return listing;
};

/** Normalize a raw `_journal/start.json` payload. */
export const normalizeLogStart = (raw: unknown): LogStart => {
  if (!isRecord(raw)) {
    throw new Error("Invalid journal start: expected an object");
  }
  return {
    version: typeof raw["version"] === "number" ? raw["version"] : 2,
    eval: normalizeEvalSpec(raw["eval"]),
    plan: normalizeEvalPlan(raw["plan"]),
  };
};

/**
 * Format-version migration: v1 logs stored a single `results.scorer` object
 * (with sibling `metrics`) instead of a `scores` array, and samples carried
 * a single `score` keyed by that scorer's name.
 */
const migrateV1Log = (
  raw: Record<string, unknown>
): Record<string, unknown> => {
  if (raw["version"] !== 1) {
    return raw;
  }
  const results = raw["results"];
  if (!isRecord(results) || !isRecord(results["scorer"])) {
    return raw;
  }
  const { scorer, metrics, ...restResults } = results;
  const score = { ...scorer, scorer: scorer["name"], metrics };
  const scorerName = typeof scorer["name"] === "string" ? scorer["name"] : "";
  const samples = Array.isArray(raw["samples"])
    ? raw["samples"].map((sample: unknown) => {
        if (!isRecord(sample) || !("score" in sample)) return sample;
        const { score: sampleScore, ...rest } = sample;
        return { ...rest, scores: { [scorerName]: sampleScore } };
      })
    : raw["samples"];
  return {
    ...raw,
    results: { ...restResults, scores: [score] },
    samples,
  };
};

/**
 * Normalize a whole raw EvalLog (static `.json` deployments and the view
 * server's `/logs/{file}` responses): format-version migrations, then
 * read-time defaults.
 */
export const normalizeEvalLog = (rawInput: unknown): LogContents["parsed"] => {
  if (!isRecord(rawInput)) {
    throw new Error("Invalid eval log: expected an object");
  }
  const raw = migrateV1Log(rawInput);
  const header = normalizeEvalHeader(raw);
  const samples = Array.isArray(raw["samples"])
    ? raw["samples"].map(normalizeEvalSample)
    : undefined;
  const log = {
    ...header,
    // normalizeEvalHeader defaults these two; EvalLog requires them.
    version: header.version ?? 2,
    status: header.status ?? "started",
    invalidated: raw["invalidated"] === true,
    reductions: raw["reductions"],
    samples,
  };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary lift (#555): `reductions` is pass-through wire data, and `stats` is required on EvalLog but only written at end-of-eval — EvalHeader models that with `stats?`, EvalLog does not. A known type/wire mismatch confined to this normalizer.
  return log as LogContents["parsed"];
};

/** Re-export for boundary call sites that read journal entries directly. */
export { normalizeConfigUpdates };
export type { ConfigUpdate };
