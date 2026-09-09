import { ColumnTable } from "arquero";

import { asyncJsonParse, isRecord } from "@tsmono/util";

import { ScanResultData, ScanResultSummary } from "../types";

import {
  optionalBooleanCell,
  optionalIdCell,
  optionalNumberCell,
  optionalStringCell,
  rawCell,
  stringCell,
} from "./arrowCells";
import {
  normalizeAgentArgs,
  normalizeInputType,
  normalizeJsonRecord,
  normalizeReferences,
  normalizeScanEvents,
  normalizeScanModelUsage,
  normalizeScanValue,
  normalizeStringList,
  normalizeTranscriptScore,
  normalizeValidationResult,
  normalizeValidationTarget,
  normalizeValueType,
  resolveTranscriptIdentityFromMetadata,
} from "./normalizeScanRow";

export const parseScanResultData = async (
  filtered: ColumnTable
): Promise<ScanResultData> => {
  const valueType = normalizeValueType(rawCell(filtered, "value_type", 0));

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
    normalizeReferences(rawCell(filtered, "event_references", 0)),
    normalizeStringList(rawCell(filtered, "input_ids", 0)),
    normalizeReferences(rawCell(filtered, "message_references", 0)),
    normalizeJsonRecord(rawCell(filtered, "metadata", 0)),
    parseScanEventsCell(filtered),
    normalizeJsonRecord(rawCell(filtered, "scan_metadata", 0)),
    parseModelUsageCell(filtered),
    normalizeStringList(rawCell(filtered, "scan_tags", 0)),
    normalizeJsonRecord(rawCell(filtered, "scanner_params", 0)),
    normalizeJsonRecord(rawCell(filtered, "transcript_metadata", 0)),
    normalizeValidationResult(rawCell(filtered, "validation_result", 0)),
    normalizeValidationTarget(rawCell(filtered, "validation_target", 0)),
    normalizeScanValue(rawCell(filtered, "value", 0), valueType),
    normalizeAgentArgs(rawCell(filtered, "transcript_agent_args", 0)),
    normalizeTranscriptScore(rawCell(filtered, "transcript_score", 0)),
  ]);

  const baseData = {
    identifier: stringCell(filtered, "identifier"),
    uuid: optionalStringCell(filtered, "uuid"),
    timestamp: optionalStringCell(filtered, "timestamp"),
    answer: optionalStringCell(filtered, "answer"),
    label: optionalStringCell(filtered, "label"),
    eventReferences,
    explanation: optionalStringCell(filtered, "explanation"),
    inputIds,
    messageReferences,
    metadata,
    scanError: optionalStringCell(filtered, "scan_error"),
    scanErrorTraceback: optionalStringCell(filtered, "scan_error_traceback"),
    scanErrorRefusal:
      optionalBooleanCell(filtered, "scan_error_refusal") ?? false,
    scanEvents,
    scanId: stringCell(filtered, "scan_id"),
    scanMetadata,
    scanModelUsage,
    scanTags,
    // Synthetic missing-label rows null this cell (createSyntheticRows).
    scanTotalTokens: optionalNumberCell(filtered, "scan_total_tokens") ?? 0,
    scannerFile: stringCell(filtered, "scanner_file"),
    scannerKey: stringCell(filtered, "scanner_key"),
    scannerName: stringCell(filtered, "scanner_name"),
    scannerParams,
    transcriptId: stringCell(filtered, "transcript_id"),
    transcriptMetadata,
    transcriptSourceId: stringCell(filtered, "transcript_source_id"),
    transcriptSourceUri: stringCell(filtered, "transcript_source_uri"),
    transcriptTaskSet: optionalStringCell(filtered, "transcript_task_set"),
    transcriptTaskId: optionalIdCell(filtered, "transcript_task_id"),
    transcriptTaskRepeat: optionalNumberCell(
      filtered,
      "transcript_task_repeat"
    ),
    transcriptAgent: optionalStringCell(filtered, "transcript_agent"),
    transcriptAgentArgs,
    transcriptDate: optionalStringCell(filtered, "transcript_date"),
    transcriptModel: optionalStringCell(filtered, "transcript_model"),
    transcriptScore,
    transcriptSuccess: optionalBooleanCell(filtered, "transcript_success"),
    transcriptTotalTime: optionalNumberCell(filtered, "transcript_total_time"),
    transcriptTotalTokens: optionalNumberCell(
      filtered,
      "transcript_total_tokens"
    ),
    transcriptMessageCount: optionalNumberCell(
      filtered,
      "transcript_message_count"
    ),
    transcriptError: optionalStringCell(filtered, "transcript_error"),
    transcriptLimit: optionalStringCell(filtered, "transcript_limit"),
    validationResult,
    validationTarget,
    value,
    valueType,
  };

  resolveTranscriptIdentityFromMetadata(baseData);

  return {
    ...baseData,
    inputType: normalizeInputType(rawCell(filtered, "input_type", 0)),
  };
};

export const parseScanResultSummaries = async (
  rowData: object[]
): Promise<ScanResultSummary[]> =>
  Promise.all(rowData.map((row) => parseScanResultSummary(row)));

const parseScanResultSummary = async (
  row: object
): Promise<ScanResultSummary> => {
  const cell = rowCell(row);
  const valueType = normalizeValueType(cell("value_type"));

  const [
    validationResult,
    validationTarget,
    transcriptMetadata,
    eventReferences,
    messageReferences,
    value,
  ] = await Promise.all([
    normalizeValidationResult(cell("validation_result")),
    normalizeValidationTarget(cell("validation_target")),
    normalizeJsonRecord(cell("transcript_metadata")),
    normalizeReferences(cell("event_references")),
    normalizeReferences(cell("message_references")),
    normalizeScanValue(cell("value"), valueType),
  ]);

  const baseSummary = {
    identifier: stringOf(cell("identifier")) ?? "",
    // Null cells fold into undefined (synthetic rows and arquero .objects()
    // both yield null) so optional fields stay honest.
    uuid: stringOf(cell("uuid")),
    label: stringOf(cell("label")),
    explanation: stringOf(cell("explanation")),
    eventReferences,
    messageReferences,
    validationResult,
    validationTarget,
    value,
    valueType,
    transcriptTaskSet: stringOf(cell("transcript_task_set")),
    transcriptTaskId: idOf(cell("transcript_task_id")),
    transcriptTaskRepeat: numberOf(cell("transcript_task_repeat")),
    transcriptModel: stringOf(cell("transcript_model")),
    transcriptMetadata,
    transcriptSourceId: stringOf(cell("transcript_source_id")) ?? "",
    scanError: stringOf(cell("scan_error")),
    // ?? false matches the parseScanResultData path's default.
    scanErrorRefusal: booleanOf(cell("scan_error_refusal")) ?? false,
    timestamp: stringOf(cell("timestamp")),
  };

  resolveTranscriptIdentityFromMetadata(baseSummary);

  return { ...baseSummary, inputType: normalizeInputType(cell("input_type")) };
};

/**
 * Summary rows arrive as arquero `.objects()` output, typed `object` with no
 * index signature. Reading a column off one is the same untyped-cell boundary
 * the ColumnTable readers cross, so it gets the same treatment: `unknown` out,
 * narrowed by the `*Of` helpers below.
 */
const rowCell =
  (row: object) =>
  (column: string): unknown =>
    isRecord(row) ? row[column] : undefined;

const stringOf = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const numberOf = (value: unknown): number | undefined =>
  typeof value === "number" ? value : undefined;

const booleanOf = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;

const idOf = (value: unknown): string | number | undefined =>
  stringOf(value) ?? numberOf(value);

const parseScanEventsCell = async (filtered: ColumnTable) => {
  const raw = rawCell(filtered, "scan_events", 0);
  return normalizeScanEvents(
    raw === undefined ? undefined : await parseJsonCell(raw)
  );
};

const parseModelUsageCell = async (filtered: ColumnTable) =>
  normalizeScanModelUsage(
    await parseJsonCell(rawCell(filtered, "scan_model_usage", 0))
  );

const parseJsonCell = async (raw: unknown): Promise<unknown> =>
  typeof raw === "string" ? await asyncJsonParse<unknown>(raw) : undefined;
