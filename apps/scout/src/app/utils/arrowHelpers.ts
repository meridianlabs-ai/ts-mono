import { ColumnTable } from "arquero";

import type { JsonValue } from "@tsmono/inspect-common/types";
import { asyncJsonParse, isJson } from "@tsmono/util";

import {
  ScanResultData,
  ScanResultReference,
  ScanResultSummary,
  ScanResultValueType,
} from "../types";

import {
  normalizeScanEvents,
  normalizeScanModelUsage,
  normalizeTranscriptMetadata,
  normalizeValidationResult,
  normalizeValidationTarget,
  resolveTranscriptIdentityFromMetadata,
} from "./normalizeScanRow";

export const parseScanResultData = async (
  filtered: ColumnTable
): Promise<ScanResultData> => {
  const valueType = filtered.get("value_type", 0) as ScanResultValueType;

  const transcript_agent_args_raw = getOptionalColumn<string>(
    filtered,
    "transcript_agent_args",
    0
  );
  const transcript_score_raw = getOptionalColumn<string>(
    filtered,
    "transcript_score",
    0
  );

  const [
    eventReferences,
    inputIds,
    messageReferences,
    metadata,
    scanEvents,
    scanMetadata,
    scanModelUsage,
    scanTags,
    scannerParams,
    transcriptMetadata,
    validationResult,
    validationTarget,
    value,
    transcriptAgentArgs,
    transcriptScore,
  ] = await Promise.all([
    parseJson(filtered.get("event_references", 0) as string),
    parseJson(filtered.get("input_ids", 0) as string),
    parseJson(filtered.get("message_references", 0) as string),
    parseJson(filtered.get("metadata", 0) as string),
    parseJson(getOptionalColumn<string>(filtered, "scan_events") ?? null),
    parseJson(filtered.get("scan_metadata", 0) as string),
    parseJson(filtered.get("scan_model_usage", 0) as string),
    parseJson(filtered.get("scan_tags", 0) as string),
    parseJson(filtered.get("scanner_params", 0) as string),
    normalizeTranscriptMetadata(filtered.get("transcript_metadata", 0)),
    normalizeValidationResult(filtered.get("validation_result", 0)),
    normalizeValidationTarget(filtered.get("validation_target", 0)),
    parseSimpleValue(filtered.get("value", 0), valueType),
    transcript_agent_args_raw
      ? parseJson(transcript_agent_args_raw)
      : Promise.resolve(undefined),
    parseJsonValue(transcript_score_raw),
  ]);

  const identifier = filtered.get("identifier", 0) as string;
  const uuid = getOptionalColumn<string>(filtered, "uuid");
  const timestamp = getOptionalColumn<string>(filtered, "timestamp");
  const answer = getOptionalColumn<string>(filtered, "answer");
  const label = getOptionalColumn<string>(filtered, "label");
  const explanation = getOptionalColumn<string>(filtered, "explanation");
  const inputType = filtered.get("input_type", 0) as
    "transcript" | "message" | "messages" | "event" | "events";
  const scanError = getOptionalColumn<string>(filtered, "scan_error");
  const scanErrorTraceback = getOptionalColumn<string>(
    filtered,
    "scan_error_traceback"
  );
  const scanErrorRefusal =
    getOptionalColumn<boolean>(filtered, "scan_error_refusal") ?? false;
  const scanId = filtered.get("scan_id", 0) as string;
  // Synthetic missing-label rows null this cell (createSyntheticRows).
  const scanTotalTokens =
    (filtered.get("scan_total_tokens", 0) as number | null) ?? 0;
  const scannerFile = filtered.get("scanner_file", 0) as string;
  const scannerKey = filtered.get("scanner_key", 0) as string;
  const scannerName = filtered.get("scanner_name", 0) as string;
  const transcriptId = filtered.get("transcript_id", 0) as string;
  const transcriptSourceId = filtered.get("transcript_source_id", 0) as string;
  const transcriptSourceUri =
    (filtered.get("transcript_source_uri", 0) as string | null) ?? "";

  const transcriptTaskSet = getOptionalColumn<string>(
    filtered,
    "transcript_task_set"
  );
  const transcriptTaskId = getOptionalColumn<string | number>(
    filtered,
    "transcript_task_id"
  );
  const transcriptTaskRepeat = getOptionalColumn<number>(
    filtered,
    "transcript_task_repeat"
  );
  const transcriptDate = getOptionalColumn<string>(filtered, "transcript_date");
  const transcriptAgent = getOptionalColumn<string>(
    filtered,
    "transcript_agent"
  );
  const transcriptModel = getOptionalColumn<string>(
    filtered,
    "transcript_model"
  );
  const transcriptSuccess = getOptionalColumn<boolean>(
    filtered,
    "transcript_success"
  );
  const transcriptTotalTime = getOptionalColumn<number>(
    filtered,
    "transcript_total_time"
  );
  const transcriptTotalTokens = getOptionalColumn<number>(
    filtered,
    "transcript_total_tokens"
  );
  const transcriptMessageCount = getOptionalColumn<number>(
    filtered,
    "transcript_message_count"
  );
  const transcriptError = getOptionalColumn<string>(
    filtered,
    "transcript_error"
  );
  const transcriptLimit = getOptionalColumn<string>(
    filtered,
    "transcript_limit"
  );

  const baseData = {
    identifier,
    uuid,
    timestamp,
    answer,
    label,
    eventReferences: (eventReferences ?? []) as ScanResultReference[],
    explanation,
    inputIds: (inputIds ?? []) as string[],
    messageReferences: (messageReferences ?? []) as ScanResultReference[],
    metadata: (metadata ?? {}) as Record<string, JsonValue>,
    scanError,
    scanErrorTraceback,
    scanErrorRefusal,
    scanEvents: normalizeScanEvents(scanEvents),
    scanId,
    scanMetadata: (scanMetadata ?? {}) as Record<string, JsonValue>,
    scanModelUsage: normalizeScanModelUsage(scanModelUsage),
    scanTags: (scanTags ?? []) as string[],
    scanTotalTokens,
    scannerFile,
    scannerKey,
    scannerName,
    scannerParams: (scannerParams ?? {}) as Record<string, JsonValue>,
    transcriptId,
    transcriptMetadata,
    transcriptSourceId,
    transcriptSourceUri,
    transcriptTaskSet,
    transcriptTaskId,
    transcriptTaskRepeat,
    transcriptAgent,
    transcriptAgentArgs: transcriptAgentArgs as Record<string, unknown>,
    transcriptDate,
    transcriptModel,
    transcriptScore,
    transcriptSuccess,
    transcriptTotalTime,
    transcriptTotalTokens,
    transcriptMessageCount,
    transcriptError,
    transcriptLimit,
    validationResult,
    validationTarget,
    value: value ?? null,
    valueType,
  };

  resolveTranscriptIdentityFromMetadata(baseData);

  return { ...baseData, inputType };
};

export const parseScanResultSummaries = async (
  rowData: object[]
): Promise<ScanResultSummary[]> =>
  Promise.all(
    rowData.map(async (row) => {
      const r = row as Record<string, unknown>;

      const valueType = r.value_type as ScanResultValueType;

      const [
        validationResult,
        validationTarget,
        transcriptMetadata,
        eventReferences,
        messageReferences,
        value,
      ] = await Promise.all([
        normalizeValidationResult(r.validation_result),
        normalizeValidationTarget(r.validation_target),
        normalizeTranscriptMetadata(r.transcript_metadata),
        parseJson(r.event_references as string),
        parseJson(r.message_references as string),
        parseSimpleValue(r.value, valueType),
      ]);

      const baseSummary = {
        identifier: r.identifier as string,
        // Null cells fold into undefined (synthetic rows and arquero
        // .objects() both yield null) so optional fields stay honest.
        uuid: (r.uuid ?? undefined) as string | undefined,
        label: (r.label ?? undefined) as string | undefined,
        explanation: (r.explanation ?? undefined) as string | undefined,
        eventReferences: (eventReferences ?? []) as ScanResultReference[],
        messageReferences: (messageReferences ?? []) as ScanResultReference[],
        validationResult: validationResult,
        validationTarget: validationTarget,
        value: value ?? null,
        valueType,
        transcriptTaskSet: (r.transcript_task_set ?? undefined) as
          string | undefined,
        transcriptTaskId: (r.transcript_task_id ?? undefined) as
          string | number | undefined,
        transcriptTaskRepeat: (r.transcript_task_repeat ?? undefined) as
          number | undefined,
        transcriptModel: (r.transcript_model ?? undefined) as
          string | undefined,
        transcriptMetadata,
        transcriptSourceId: r.transcript_source_id as string,
        scanError: typeof r.scan_error === "string" ? r.scan_error : undefined,
        // ?? false matches the parseScanResultData path's default.
        scanErrorRefusal: (r.scan_error_refusal ?? false) as boolean,
        timestamp: r.timestamp ? (r.timestamp as string) : undefined,
      };

      resolveTranscriptIdentityFromMetadata(baseSummary);

      const inputType = r.input_type as
        "transcript" | "message" | "messages" | "event" | "events";

      return { ...baseSummary, inputType };
    })
  );

const parseJson = async <T>(text: string | null): Promise<T | undefined> =>
  text !== null ? asyncJsonParse<T>(text) : undefined;

const parseSimpleValue = (
  val: unknown,
  valueType: ScanResultValueType
): Promise<
  string | number | boolean | null | unknown[] | object | undefined
> =>
  valueType === "object" || valueType === "array"
    ? parseJson<object | unknown[]>(val as string)
    : Promise.resolve(val as string | number | boolean | null);

const parseJsonValue = (val?: unknown): Promise<JsonValue | undefined> => {
  if (!val) {
    return Promise.resolve(undefined);
  }

  if (typeof val === "string" && isJson(val)) {
    return parseJson<JsonValue>(val).then((parsed) => parsed as JsonValue);
  } else {
    return Promise.resolve(val as JsonValue);
  }
};

function getOptionalColumn<T>(
  table: ColumnTable,
  columnName: string,
  rowIndex: number = 0
): T | undefined {
  if (!table.columnNames().includes(columnName)) {
    return undefined;
  }
  // Boundary cast: arquero cells are untyped. Null cells fold into undefined
  // so optional fields stay honestly optional for downstream consumers.
  const value = table.get(columnName, rowIndex) as T | null | undefined;
  return value ?? undefined;
}
