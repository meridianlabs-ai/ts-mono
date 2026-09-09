import { from } from "arquero";
import { describe, expect, it } from "vitest";

import { ScanResultData, ScanResultSummary } from "../types";

import { parseScanResultData, parseScanResultSummaries } from "./arrowHelpers";

// Typical row data as it would come from arquero .objects()
const typicalSummaryRow = {
  identifier: "test-uuid-123",
  uuid: "test-uuid-123",
  label: "test-label",
  explanation: "Test explanation",
  input_type: "transcript",
  value_type: "object",
  value: '{"score": 0.95}',
  validation_result: "true",
  validation_target: "true",
  event_references: '[{"type":"event","id":"evt-1"}]',
  message_references: "[]",
  transcript_metadata:
    '{"model":"gpt-4","task_name":"test-task","id":"task-1","epoch":1}',
  transcript_source_id: "source-123",
  transcript_task_set: undefined,
  transcript_task_id: undefined,
  transcript_task_repeat: undefined,
  transcript_model: undefined,
  scan_error: undefined,
  scan_error_refusal: false,
  timestamp: "2024-01-15T10:30:00Z",
};

const expectedSummary: Partial<ScanResultSummary> = {
  identifier: "test-uuid-123",
  uuid: "test-uuid-123",
  label: "test-label",
  explanation: "Test explanation",
  inputType: "transcript",
  valueType: "object",
  value: { score: 0.95 },
  validationResult: true,
  validationTarget: true,
  eventReferences: [{ type: "event", id: "evt-1" }],
  messageReferences: [],
  transcriptSourceId: "source-123",
  // These should be resolved from metadata since they're undefined in row
  transcriptModel: "gpt-4",
  transcriptTaskSet: "test-task",
  transcriptTaskId: "task-1",
  transcriptTaskRepeat: 1,
  scanErrorRefusal: false,
};

// Typical column data as it would come from a ColumnTable
const typicalColumnData: Record<string, unknown> = {
  identifier: "data-identifier-456",
  uuid: "data-uuid-456",
  input_type: "message",
  value_type: "number",
  value: 42,
  answer: "test answer",
  validation_result: '{"passed":true}',
  validation_target: '{"passed":true}',
  event_references: "[]",
  message_references: '[{"type":"message","id":"msg-1"}]',
  input_ids: '["id-1","id-2"]',
  metadata: '{"key":"value"}',
  scan_events: "[]",
  scan_metadata: "{}",
  scan_model_usage: "{}",
  scan_tags: '["tag1"]',
  scanner_params: "{}",
  transcript_metadata: '{"model":"claude-3"}',
  transcript_source_id: "src-456",
  transcript_source_uri: "s3://bucket/path",
  transcript_id: "trans-123",
  scan_id: "scan-789",
  scan_total_tokens: 1500,
  scanner_file: "scanner.py",
  scanner_key: "test_scanner",
  scanner_name: "Test Scanner",
  explanation: "Data explanation",
  scan_error: null,
  scan_error_traceback: null,
  scan_error_refusal: false,
  timestamp: "2024-02-20T14:00:00Z",
};

const expectedData: Partial<ScanResultData> = {
  identifier: "data-identifier-456",
  uuid: "data-uuid-456",
  inputType: "message",
  valueType: "number",
  value: 42,
  validationResult: { passed: true },
  validationTarget: { passed: true },
  eventReferences: [],
  messageReferences: [{ type: "message", id: "msg-1" }],
  inputIds: ["id-1", "id-2"],
  metadata: { key: "value" },
  scanEvents: [],
  scanMetadata: {},
  scanModelUsage: {},
  scanTags: ["tag1"],
  scannerParams: {},
  transcriptSourceId: "src-456",
  transcriptSourceUri: "s3://bucket/path",
  transcriptId: "trans-123",
  scanId: "scan-789",
  scanTotalTokens: 1500,
  scannerFile: "scanner.py",
  scannerKey: "test_scanner",
  scannerName: "Test Scanner",
  explanation: "Data explanation",
  scanErrorRefusal: false,
  transcriptModel: "claude-3",
};

const nullMetadataSummaryRow = {
  ...typicalSummaryRow,
  transcript_metadata: null,
};

const nullMetadataExpectedSummary: Partial<ScanResultSummary> = {
  identifier: "test-uuid-123",
  uuid: "test-uuid-123",
  label: "test-label",
  transcriptModel: undefined,
  transcriptTaskSet: undefined,
  transcriptTaskId: undefined,
  transcriptTaskRepeat: undefined,
};

describe("parseScanResultSummaries", () => {
  it.each<[object[], Partial<ScanResultSummary>[], string]>([
    [[], [], "empty array"],
    [[typicalSummaryRow], [expectedSummary], "typical row"],
    [
      [nullMetadataSummaryRow],
      [nullMetadataExpectedSummary],
      "row with null transcript_metadata",
    ],
  ])(
    "returns expected output for %s",
    async (input, expected, _desc: string) => {
      const result = await parseScanResultSummaries(input);
      expect(result).toHaveLength(expected.length);
      for (const [i, r] of result.entries()) {
        expect(r).toMatchObject(expected[i]!);
      }
    }
  );

  it("normalizes a legacy-shaped row at the parse boundary", async () => {
    const legacyRow = {
      ...typicalSummaryRow,
      // Raw booleans (pre Jan 7 2026 storage) instead of JSON strings
      validation_result: false,
      validation_target: true,
      scan_error: null,
      // Identity lives only inside transcript_metadata (old scans)
      transcript_task_set: undefined,
      transcript_task_id: undefined,
      transcript_task_repeat: undefined,
      transcript_model: undefined,
    };
    const [result] = await parseScanResultSummaries([legacyRow]);
    expect(result).toBeDefined();
    expect(result?.validationResult).toBe(false);
    expect(result?.validationTarget).toBe(true);
    expect(result?.scanError).toBeUndefined();
    expect(result?.transcriptModel).toBe("gpt-4");
    expect(result?.transcriptTaskSet).toBe("test-task");
    expect(result?.transcriptTaskId).toBe("task-1");
    expect(result?.transcriptTaskRepeat).toBe(1);
    expect(result?.transcriptMetadata).toEqual({
      model: "gpt-4",
      task_name: "test-task",
      id: "task-1",
      epoch: 1,
    });
  });

  it("treats unusable validation values as not validated", async () => {
    const row = {
      ...typicalSummaryRow,
      validation_result: null,
      validation_target: undefined,
    };
    const [result] = await parseScanResultSummaries([row]);
    expect(result?.validationResult).toBeUndefined();
    expect(result?.validationTarget).toBeUndefined();
  });
});

const nullMetadataColumnData: Record<string, unknown> = {
  ...typicalColumnData,
  transcript_metadata: null,
};

const nullMetadataExpectedData: Partial<ScanResultData> = {
  identifier: "data-identifier-456",
  uuid: "data-uuid-456",
  transcriptModel: undefined,
};

describe("parseScanResultData", () => {
  it.each<[Record<string, unknown>, Partial<ScanResultData>, string]>([
    [typicalColumnData, expectedData, "typical data"],
    [
      nullMetadataColumnData,
      nullMetadataExpectedData,
      "data with null transcript_metadata",
    ],
  ])(
    "returns expected output for %s",
    async (input, expected, _desc: string) => {
      const table = from([input]);
      const result = await parseScanResultData(table);
      expect(result).toMatchObject(expected);
    }
  );

  it("handles missing scan_events column gracefully", async () => {
    const { scan_events: _, ...dataWithoutEvents } = typicalColumnData;
    const table = from([dataWithoutEvents]);
    const result = await parseScanResultData(table);
    expect(result.scanEvents).toBeUndefined();
  });

  it("fills event-level defaults on legacy scan_events", async () => {
    const data = {
      ...typicalColumnData,
      // Legacy model event missing working_start and output
      scan_events: JSON.stringify([
        { event: "model", timestamp: "2024-01-01T00:00:00Z" },
      ]),
    };
    const table = from([data]);
    const result = await parseScanResultData(table);
    const event = result.scanEvents?.[0];
    if (event?.event !== "model") {
      throw new Error("expected a model event");
    }
    expect(event.working_start).toBe(0);
    expect(event.output).toEqual({ model: "", choices: [], completion: "" });
  });

  it("fills pydantic token defaults on scan_model_usage", async () => {
    const data = {
      ...typicalColumnData,
      scan_model_usage: '{"openai/gpt-4":{"input_tokens":10}}',
    };
    const table = from([data]);
    const result = await parseScanResultData(table);
    expect(result.scanModelUsage).toEqual({
      "openai/gpt-4": { input_tokens: 10, output_tokens: 0, total_tokens: 0 },
    });
  });
});
