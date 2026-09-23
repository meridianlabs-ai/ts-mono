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

// JSON.parse is iterative but JSON(5).stringify recurses, so a deeply nested
// cell parses and then overflows the stack when the viewer serializes it.
const kMaxJsonDepth = 256;

const pruneDeepJson = <T>(root: T, source: string): T => {
  // Every nesting level costs at least two source characters, so a cell this
  // short cannot exceed the cap and the walk is skipped for ordinary rows.
  if (source.length <= 2 * kMaxJsonDepth) {
    return root;
  }
  if (!isRecord(root) && !Array.isArray(root)) {
    return root;
  }
  const stack: { node: Record<string, unknown> | unknown[]; depth: number }[] =
    [{ node: root, depth: 1 }];
  for (let frame = stack.pop(); frame !== undefined; frame = stack.pop()) {
    const { node, depth } = frame;
    for (const [key, child] of Object.entries(node)) {
      if (!isRecord(child) && !Array.isArray(child)) {
        continue;
      }
      if (depth >= kMaxJsonDepth) {
        if (Array.isArray(node)) {
          node[Number(key)] = null;
        } else {
          node[key] = null;
        }
      } else {
        stack.push({ node: child, depth: depth + 1 });
      }
    }
  }
  return root;
};

const parseJsonLenient = async (
  text: string
): Promise<JsonValue | undefined> => {
  try {
    return pruneDeepJson(await asyncJsonParse<JsonValue>(text), text);
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

/**
 * A JSON object column (metadata, scan_metadata, scanner_params,
 * transcript_metadata). Absent or malformed cells become an empty record.
 */
export const normalizeJsonRecord = async (
  raw: unknown
): Promise<Record<string, JsonValue>> => {
  const parsed = await parseJsonCell(raw);
  return isRecord(parsed) ? parsed : {};
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

// `satisfies` ties these to the generated unions: regenerating the schema
// with a new value/input kind errors here until the map is updated, so a
// statically-known kind can't silently normalize to the fallback.
const kValueTypes = {
  boolean: true,
  number: true,
  string: true,
  array: true,
  object: true,
  null: true,
} satisfies Record<ScanResultValueType, true>;

const isValueType = (raw: string): raw is ScanResultValueType =>
  Object.hasOwn(kValueTypes, raw);

/** An unrecognized value_type renders like a null result rather than lying. */
export const normalizeValueType = (raw: unknown): ScanResultValueType =>
  typeof raw === "string" && isValueType(raw) ? raw : "null";

const kInputTypes = {
  transcript: true,
  event: true,
  events: true,
  message: true,
  messages: true,
  timeline: true,
  timelines: true,
} satisfies Record<ScannerInputType, true>;

const isInputType = (raw: string): raw is ScannerInputType =>
  Object.hasOwn(kInputTypes, raw);

/**
 * An unrecognized input_type (a newer inspect_scout adding a scanner input
 * kind) stays undefined so the viewer falls back to neutral source-id
 * rendering rather than pretending the row is a transcript.
 */
export const normalizeInputType = (
  raw: unknown
): ScannerInputType | undefined =>
  typeof raw === "string" && isInputType(raw) ? raw : undefined;

type ScanValue = Pick<ScanResultSummary, "value" | "valueType">;

const kNullScanValue: ScanValue = { value: null, valueType: "null" };

/**
 * The `value` cell: JSON-encoded for object/array results, a scalar
 * otherwise (text under a number/boolean tag was already cast by
 * `castScanValue`). The value_type tag is authored independently of the cell
 * and every consumer narrows on the tag alone, so the returned tag always
 * matches the value's runtime shape: an array/object tag over an absent,
 * malformed, or other-shaped cell becomes null, and a scalar keeps its value
 * under the tag of its own type.
 */
export const normalizeScanValue = async (
  raw: unknown,
  valueType: ScanResultValueType
): Promise<ScanValue> => {
  if (valueType === "array") {
    const parsed = await parseJsonCell(raw);
    return Array.isArray(parsed)
      ? { value: parsed, valueType }
      : kNullScanValue;
  }
  if (valueType === "object") {
    const parsed = await parseJsonCell(raw);
    return isRecord(parsed) ? { value: parsed, valueType } : kNullScanValue;
  }
  if (typeof raw === "string") return { value: raw, valueType: "string" };
  if (typeof raw === "number") return { value: raw, valueType: "number" };
  if (typeof raw === "boolean") return { value: raw, valueType: "boolean" };
  return kNullScanValue;
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
      return pruneDeepJson(await asyncJsonParse<JsonValue>(raw), raw);
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
