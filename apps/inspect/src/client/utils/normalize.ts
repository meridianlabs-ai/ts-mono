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
  EvalStats,
  LogUpdate,
} from "@tsmono/inspect-common/types";
import { isRecord } from "@tsmono/util";

import { EvalLogStatus } from "../../@types/extraInspect";
import { EvalHeader } from "../api/types";
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
  // Boundary lifts (#555): pass-through fields the normalizers don't cover
  // are wire data TypeScript can't verify; each is optional on EvalHeader so
  // absence stays representable.
  return {
    version: typeof raw["version"] === "number" ? raw["version"] : 2,
    status: (raw["status"] ?? "started") as EvalLogStatus,
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
 * Normalize a whole raw EvalLog (static `.json` deployments). Callers apply
 * format-version migrations (e.g. the v1 `results.scorer` reshape) before
 * this runs — this fills read-time defaults only.
 */
export const normalizeEvalLog = (raw: unknown): EvalLog => {
  if (!isRecord(raw)) {
    throw new Error("Invalid eval log: expected an object");
  }
  const header = normalizeEvalHeader(raw);
  const samples = Array.isArray(raw["samples"])
    ? raw["samples"].map(normalizeEvalSample)
    : undefined;
  return {
    ...header,
    // normalizeEvalHeader defaults these two; EvalLog requires them.
    version: header.version ?? 2,
    status: header.status ?? "started",
    invalidated: raw["invalidated"] === true,
    reductions: raw["reductions"] as EvalLog["reductions"],
    samples,
    // Boundary lift (#555): stats is required on EvalLog but only written at
    // end-of-eval; in-progress logs genuinely lack it. EvalHeader models
    // that with `stats?`, EvalLog does not — a known type/wire mismatch that
    // stays confined to this normalizer.
  } as EvalLog;
};

/** Re-export for boundary call sites that read journal entries directly. */
export { normalizeConfigUpdates };
export type { ConfigUpdate };
