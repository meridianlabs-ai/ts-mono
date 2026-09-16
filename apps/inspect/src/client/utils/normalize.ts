import {
  normalizeConfigUpdates,
  normalizeEvalPlan,
  normalizeEvalResults,
  normalizeEvalSample,
  normalizeEvalSpec,
} from "@tsmono/inspect-common/normalize";
import {
  ConfigUpdate,
  EvalError,
  EvalLog,
  EvalMetric,
  EvalStats,
  LogUpdate,
} from "@tsmono/inspect-common/types";
import { isRecord } from "@tsmono/util";

import { EvalLogStatus } from "../../@types/extraInspect";
import { EvalHeader, LogPreview } from "../api/types";
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
    stats: raw["stats"] as EvalStats | undefined,
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

// `satisfies` keeps this keyset exhaustive: a status added to the generated
// union fails typecheck here instead of silently normalizing to undefined.
const kEvalLogStatuses = {
  started: true,
  success: true,
  cancelled: true,
  error: true,
} satisfies Record<EvalLogStatus, true>;

const isEvalLogStatus = (value: unknown): value is EvalLogStatus =>
  typeof value === "string" && Object.hasOwn(kEvalLogStatuses, value);

const stringOr = (value: unknown, fallback: string): string =>
  typeof value === "string" ? value : fallback;

const optionalString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const normalizeEvalError = (raw: unknown): EvalError | null => {
  if (!isRecord(raw)) {
    return null;
  }
  return {
    ...raw,
    message: stringOr(raw["message"], ""),
    traceback: stringOr(raw["traceback"], ""),
    traceback_ansi: stringOr(raw["traceback_ansi"], ""),
  };
};

// A metric without a numeric value can't feed the score column, so it
// degrades to "no primary metric" rather than a fabricated 0.
const normalizeEvalMetric = (raw: unknown): EvalMetric | null => {
  if (!isRecord(raw) || typeof raw["value"] !== "number") {
    return null;
  }
  return {
    ...raw,
    name: stringOr(raw["name"], ""),
    value: raw["value"],
    params: isRecord(raw["params"]) ? raw["params"] : {},
    group: optionalString(raw["group"]) ?? null,
    metadata: isRecord(raw["metadata"]) ? raw["metadata"] : null,
  };
};

const normalizeModelRoles = (raw: unknown): Record<string, string> | null => {
  if (!isRecord(raw)) {
    return null;
  }
  const roles: Record<string, string> = {};
  for (const [role, model] of Object.entries(raw)) {
    if (typeof model === "string") roles[role] = model;
  }
  return roles;
};

/**
 * Normalize one `listing.json` entry (pydantic's `LogOverview`), filling the
 * defaults the model applies at read time: `error`, `model_roles` and
 * `primary_metric` are null when absent, required strings are "" (eval_id
 * synthesized from run_id/task_id/started_at, mirroring normalizeEvalSpec),
 * task_version is 0. Bundles built by older inspect_ai releases predate
 * `model_roles` and `invalidated` entirely, and write with exclude_none, so
 * absent fields are the norm rather than the exception.
 */
export const normalizeLogPreview = (raw: unknown): LogPreview => {
  if (!isRecord(raw)) {
    throw new Error("Invalid log preview: expected an object");
  }
  const run_id = stringOr(raw["run_id"], "");
  const task_id = stringOr(raw["task_id"], "");
  const started_at = optionalString(raw["started_at"]);
  const task_version = raw["task_version"];
  return {
    // Spread first so fields the schema grows later survive parsing (matching
    // normalizeEvalHeader); normalized fields override below.
    ...raw,
    eval_id: stringOr(
      raw["eval_id"],
      `${run_id}-${task_id}-${started_at ?? ""}`
    ),
    run_id,
    task: stringOr(raw["task"], ""),
    task_id,
    task_version:
      typeof task_version === "number" || typeof task_version === "string"
        ? task_version
        : 0,
    version: typeof raw["version"] === "number" ? raw["version"] : undefined,
    status: isEvalLogStatus(raw["status"]) ? raw["status"] : undefined,
    error: normalizeEvalError(raw["error"]),
    model: stringOr(raw["model"], ""),
    model_roles: normalizeModelRoles(raw["model_roles"]),
    started_at,
    completed_at: optionalString(raw["completed_at"]),
    primary_metric: normalizeEvalMetric(raw["primary_metric"]),
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
export const normalizeEvalLog = (rawInput: unknown): EvalLog => {
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
  return log as EvalLog;
};

/** Re-export for boundary call sites that read journal entries directly. */
export { normalizeConfigUpdates };
export type { ConfigUpdate };
