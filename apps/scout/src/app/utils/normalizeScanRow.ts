import { normalizeEvents } from "@tsmono/inspect-common/normalize";
import type {
  Event,
  JsonValue,
  ModelUsage,
} from "@tsmono/inspect-common/types";
import { asyncJsonParse, isRecord } from "@tsmono/util";

/**
 * Boundary normalizers (#555) for scout's Arrow-derived scan rows.
 * Scan dataframes are written by many inspect_scout versions; these fill
 * the legacy shapes at the parse layer (parseScanResultData /
 * parseScanResultSummaries) so every consumer of ScanResultSummary and
 * ScanResultData can trust the declared types.
 */

const parseJsonLenient = async (text: string): Promise<unknown> => {
  try {
    return await asyncJsonParse<unknown>(text);
  } catch {
    return undefined;
  }
};

/**
 * validation_result was stored as a raw boolean before Jan 7 2026 and as a
 * JSON string after; handle both. Anything that isn't a boolean or a
 * label->boolean record (absent cell, unparseable string) means "not
 * validated" and comes back undefined.
 */
export const normalizeValidationResult = async (
  raw: unknown
): Promise<boolean | Record<string, boolean> | undefined> => {
  const value = typeof raw === "string" ? await parseJsonLenient(raw) : raw;
  if (typeof value === "boolean") {
    return value;
  }
  if (isRecord(value)) {
    const result: Record<string, boolean> = {};
    for (const [label, entry] of Object.entries(value)) {
      if (typeof entry === "boolean") {
        result[label] = entry;
      }
    }
    return result;
  }
  return undefined;
};

/**
 * validation_target has the same raw-value-before / JSON-string-after
 * duality as validation_result, but any JSON value is a legal target.
 */
export const normalizeValidationTarget = async (
  raw: unknown
): Promise<JsonValue | undefined> => {
  if (typeof raw === "string") {
    try {
      return await asyncJsonParse<JsonValue>(raw);
    } catch {
      // Legacy targets could be plain (non-JSON) strings; keep them verbatim.
      return raw;
    }
  }
  if (typeof raw === "boolean" || typeof raw === "number" || raw === null) {
    return raw;
  }
  return undefined;
};

/** Absent or malformed transcript_metadata becomes an empty record. */
export const normalizeTranscriptMetadata = async (
  raw: unknown
): Promise<Record<string, JsonValue>> => {
  if (typeof raw !== "string") {
    return {};
  }
  try {
    const parsed = await asyncJsonParse<JsonValue>(raw);
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
};

/**
 * Fill pydantic token defaults on parsed scan_model_usage entries
 * (input_tokens/output_tokens/total_tokens default to 0 upstream), mirroring
 * normalizeModelOutput's usage handling in @tsmono/inspect-common. Entries
 * that aren't records are dropped — pydantic would refuse them outright.
 */
export const normalizeScanModelUsage = (
  raw: unknown
): Record<string, ModelUsage> => {
  if (!isRecord(raw)) {
    return {};
  }
  let changed = false;
  const usage: Record<string, unknown> = {};
  for (const [model, entry] of Object.entries(raw)) {
    if (!isRecord(entry)) {
      changed = true;
      continue;
    }
    const fixes: Record<string, unknown> = {};
    for (const field of ["input_tokens", "output_tokens", "total_tokens"]) {
      if (typeof entry[field] !== "number") {
        fixes[field] = 0;
      }
    }
    if (Object.keys(fixes).length > 0) {
      changed = true;
      usage[model] = { ...entry, ...fixes };
    } else {
      usage[model] = entry;
    }
  }
  // Boundary lift (#555): token defaults are filled above; remaining content
  // is what the writer serialized.
  return (changed ? usage : raw) as Record<string, ModelUsage>;
};

/** Absent scan_events stays absent; present events get event-level fills. */
export const normalizeScanEvents = (raw: unknown): Event[] | undefined =>
  raw === undefined ? undefined : normalizeEvents(raw);

interface TranscriptIdentity {
  transcriptModel?: string;
  transcriptTaskSet?: string;
  transcriptTaskId?: string | number;
  transcriptTaskRepeat?: number;
  transcriptMetadata: Record<string, JsonValue>;
}

/**
 * Old scans kept transcript identity (model, task_name, id, epoch) inside
 * transcript_metadata instead of first-class columns; lift it out when the
 * columns are absent.
 */
export const resolveTranscriptIdentityFromMetadata = (
  data: TranscriptIdentity
): void => {
  const metadata = data.transcriptMetadata;
  if (data.transcriptModel === undefined) {
    const model = metadata["model"];
    if (typeof model === "string") {
      data.transcriptModel = model;
    }
  }
  if (data.transcriptTaskSet === undefined) {
    const taskName = metadata["task_name"];
    if (typeof taskName === "string") {
      data.transcriptTaskSet = taskName;
    }
  }
  if (data.transcriptTaskId === undefined) {
    const id = metadata["id"];
    if (typeof id === "string" || typeof id === "number") {
      data.transcriptTaskId = id;
    }
  }
  if (data.transcriptTaskRepeat === undefined) {
    const epoch = metadata["epoch"];
    if (typeof epoch === "number") {
      data.transcriptTaskRepeat = epoch;
    }
  }
};
