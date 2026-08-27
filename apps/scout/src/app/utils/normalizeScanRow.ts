import {
  normalizeEvents,
  normalizeModelUsage,
} from "@tsmono/inspect-common/normalize";
import type {
  Event,
  JsonValue,
  ModelUsage,
} from "@tsmono/inspect-common/types";
import { asyncJsonParse, isJson, isRecord } from "@tsmono/util";

import type {
  ScannerInputType,
  ScanResultReference,
  ScanResultSummary,
  ScanResultValueType,
} from "../types";

/**
 * Boundary normalizers (#555) for scout's Arrow-derived scan rows.
 * Scan dataframes are written by many inspect_scout versions; these fill
 * the legacy shapes at the parse layer (parseScanResultData /
 * parseScanResultSummaries) so every consumer of ScanResultSummary and
 * ScanResultData can trust the declared types.
 */

const parseJsonLenient = async (
  text: string
): Promise<JsonValue | undefined> => {
  try {
    return await asyncJsonParse<JsonValue>(text);
  } catch {
    return undefined;
  }
};

/**
 * Every JSON-bearing scan column arrives as a string cell. Absent and
 * unparseable cells both read as undefined, so each column normalizer below
 * decides its own empty value rather than inheriting one.
 */
const parseJsonCell = async (raw: unknown): Promise<JsonValue | undefined> =>
  typeof raw === "string" ? await parseJsonLenient(raw) : undefined;

/** A JSON object column (metadata, scan_metadata, scanner_params). */
export const normalizeJsonRecord = async (
  raw: unknown
): Promise<Record<string, JsonValue>> => {
  const parsed = await parseJsonCell(raw);
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? parsed
    : {};
};

/** A JSON array-of-strings column (input_ids, scan_tags). */
export const normalizeStringList = async (raw: unknown): Promise<string[]> => {
  const parsed = await parseJsonCell(raw);
  return Array.isArray(parsed)
    ? parsed.filter((entry): entry is string => typeof entry === "string")
    : [];
};

/**
 * message_references / event_references. Entries missing the two fields the
 * viewer navigates by are dropped — they can't resolve to anything.
 */
export const normalizeReferences = async (
  raw: unknown
): Promise<ScanResultReference[]> => {
  const parsed = await parseJsonCell(raw);
  if (!Array.isArray(parsed)) {
    return [];
  }
  const references: ScanResultReference[] = [];
  for (const entry of parsed) {
    if (!isRecord(entry) || typeof entry["id"] !== "string") {
      continue;
    }
    const type = entry["type"];
    if (type !== "message" && type !== "event") {
      continue;
    }
    const cite = entry["cite"];
    references.push({
      type,
      id: entry["id"],
      ...(typeof cite === "string" ? { cite } : {}),
    });
  }
  return references;
};

/** transcript_agent_args: an opaque JSON object, absent when unset. */
export const normalizeAgentArgs = async (
  raw: unknown
): Promise<Record<string, unknown> | undefined> => {
  const parsed = await parseJsonCell(raw);
  return isRecord(parsed) ? parsed : undefined;
};

/**
 * transcript_score is stored either as a JSON string or as the raw scalar
 * (older scans wrote the number/boolean straight into the cell).
 */
export const normalizeTranscriptScore = async (
  raw: unknown
): Promise<JsonValue | undefined> => {
  if (typeof raw === "string") {
    return isJson(raw) ? await parseJsonLenient(raw) : raw;
  }
  return typeof raw === "number" || typeof raw === "boolean" ? raw : undefined;
};

const kValueTypes: readonly ScanResultValueType[] = [
  "boolean",
  "number",
  "string",
  "array",
  "object",
  "null",
];

/** An unrecognized value_type renders like a null result rather than lying. */
export const normalizeValueType = (raw: unknown): ScanResultValueType =>
  kValueTypes.find((type) => type === raw) ?? "null";

const kInputTypes: readonly ScannerInputType[] = [
  "transcript",
  "event",
  "events",
  "message",
  "messages",
  "timeline",
  "timelines",
];

/**
 * An unrecognized input_type (a newer inspect_scout adding a scanner input
 * kind) stays undefined so the viewer falls back to neutral source-id
 * rendering rather than pretending the row is a transcript.
 */
export const normalizeInputType = (
  raw: unknown
): ScannerInputType | undefined => kInputTypes.find((type) => type === raw);

/**
 * The `value` cell: JSON-encoded for object/array results, the raw scalar
 * otherwise.
 */
export const normalizeScanValue = async (
  raw: unknown,
  valueType: ScanResultValueType
): Promise<ScanResultSummary["value"]> => {
  if (valueType === "object" || valueType === "array") {
    const parsed = await parseJsonCell(raw);
    return typeof parsed === "object" ? parsed : null;
  }
  return typeof raw === "string" ||
    typeof raw === "number" ||
    typeof raw === "boolean"
    ? raw
    : null;
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
    // A record with no boolean entries left carries no usable validation —
    // treat it like "never validated" so it doesn't count toward
    // hasValidations or render an empty cell.
    return Object.keys(result).length > 0 ? result : undefined;
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
 * Fill pydantic token defaults on parsed scan_model_usage entries via the
 * shared normalizeModelUsage. Entries that aren't records are dropped —
 * pydantic would refuse them outright.
 */
export const normalizeScanModelUsage = (
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
  // Boundary lift (#555): every entry round-tripped unchanged, so the
  // original record already satisfies the type.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary lift (#555): normalizeModelUsage returned every entry unchanged, which is the proof this record is already Record<string, ModelUsage>
  return changed ? usage : (raw as Record<string, ModelUsage>);
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
