import { isRecord } from "@tsmono/util";

import type { EvalSample } from "../types";

import { normalizeEvents, normalizeModelOutput } from "./events";
import { normalizeModelUsageMap } from "./summary";

/**
 * Normalize a raw EvalSample of any vintage into the current shape:
 * legacy migrations (mirroring pydantic's `EvalSample.migrate_deprecated`),
 * then read-time defaults for fields the type declares required.
 *
 * Does NOT expand pool refs or resolve `attachment://` refs — that stays
 * with the caller (see `resolveSample` in apps/inspect), which runs it on
 * the normalized result.
 */
export const normalizeEvalSample = (raw: unknown): EvalSample => {
  if (!isRecord(raw)) {
    throw new Error("Invalid sample data: expected an object");
  }
  const sample: Record<string, unknown> = { ...raw };

  // Legacy migration: events + attachments were nested under `transcript`.
  const transcript = sample["transcript"];
  if (isRecord(transcript)) {
    sample["events"] = transcript["events"];
    sample["attachments"] = transcript["content"];
    delete sample["transcript"];
  }
  // Legacy migration: a single `score` predates the `scores` map. Python
  // keys the converted score under a placeholder scorer name; the v1
  // whole-log migration (static-http fetch) uses the real scorer name when
  // it has the results context, so this only catches samples read alone.
  if ("score" in sample && !("scores" in sample)) {
    sample["scores"] = { scorer: sample["score"] };
    delete sample["score"];
  }

  if (typeof sample["input"] !== "string" && !Array.isArray(sample["input"])) {
    sample["input"] = "";
  }
  if (
    typeof sample["target"] !== "string" &&
    !Array.isArray(sample["target"])
  ) {
    sample["target"] = "";
  }
  if (!Array.isArray(sample["messages"])) sample["messages"] = [];
  sample["output"] = normalizeModelOutput(sample["output"]);
  if (!isRecord(sample["scores"])) sample["scores"] = null;
  for (const field of ["metadata", "store", "attachments"]) {
    if (!isRecord(sample[field])) sample[field] = {};
  }
  // Usage entries carry their own required-with-default token fields.
  for (const field of ["model_usage", "role_usage"]) {
    sample[field] = normalizeModelUsageMap(sample[field]);
  }
  sample["events"] = normalizeEvents(sample["events"]);

  // `count` on fallbacks and the traceback pair on retry errors default
  // upstream; fill them so their renderers can read them unguarded.
  if (Array.isArray(sample["model_fallbacks"])) {
    sample["model_fallbacks"] = sample["model_fallbacks"].map(
      (fallback: unknown) =>
        isRecord(fallback) && typeof fallback["count"] !== "number"
          ? { ...fallback, count: 1 }
          : fallback
    );
  }
  if (Array.isArray(sample["error_retries"])) {
    sample["error_retries"] = sample["error_retries"].map((retry: unknown) => {
      if (!isRecord(retry)) return retry;
      const fixed = { ...retry };
      for (const field of ["message", "traceback", "traceback_ansi"]) {
        if (typeof fixed[field] !== "string") fixed[field] = "";
      }
      // Retry events render through the same transcript components as the
      // main stream; normalize recursively. The field is optional — absent
      // stays absent.
      if (fixed["events"] !== undefined) {
        fixed["events"] = normalizeEvents(fixed["events"]);
      }
      return fixed;
    });
  }

  // Boundary lift (#555): required fields are filled above; remaining
  // content is wire data TypeScript can't verify.
  return sample as unknown as EvalSample;
};
