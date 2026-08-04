/**
 * The drift guard for the two value surfaces: the data layer evaluates
 * conditions/sorts through the record-level column schema
 * (`createLogColumnSchema`), while the grid reads shaped rows through its
 * column defs' accessors (cells, overlay evaluation, find text). They are
 * supposed to agree because `buildLogListRow` is a pure projection of the
 * record — this test makes that an invariant instead of a convention: for
 * every grid column, the schema's value over the record must equal the
 * grid accessor's value over the shaped row, across both view modes.
 */

import { renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import {
  primitiveText,
  type LogListingRow,
  type ScorerMap,
} from "../../../../log_data";
import { fileLogItem, type FileLogItemView } from "../../fileLogItem";
import { buildLogListRow } from "../logListRow";

import { useLogListColumns } from "./hooks";

const scorerMap: ScorerMap = {
  "grader/accuracy": {
    scorerName: "grader",
    metricName: "accuracy",
    valueType: "number",
  },
  "judge/accuracy": {
    scorerName: "judge",
    metricName: "accuracy",
    valueType: "number",
  },
};

vi.mock("../../../../app_config", () => ({ useLogDir: () => "/logs" }));

vi.mock("../../../../state/store", () => ({
  useStore: (selector: (state: unknown) => unknown) =>
    selector({
      logs: { listing: { columnVisibility: {} } },
      logsActions: { setLogsColumnVisibility: () => {} },
    }),
}));

// The one async hook the column hook reads, stubbed with settled facts.
vi.mock("../../useLogColumnFacts", () => ({
  useLogColumnFacts: () => ({
    data: { scorerMap, hasSampleLimits: false },
    loading: false,
  }),
}));

const baseRecord = {
  name: "/logs/sub/2024-01-05T10-00-00+00-00_mytask_abc123.eval",
  task: "mytask",
  task_id: "abc123",
  model: "gpt-4",
  model_roles: { grader: "gpt-4o" },
  status: "success",
  completed_at: "2024-02-01T00:00:00Z",
  primary_metric: { name: "accuracy", value: 0.75 },
  retried: false,
  header: {
    results: { total_samples: 10, completed_samples: 8 },
    eval: {
      sandbox: { type: "docker" },
      task_file: "task.py",
      task_args: { split: "dev" },
    },
    tags: ["smoke", "nightly"],
    sampleErrorCount: 2,
    error: { message: "boom\nstack trace" },
    sampleLimits: [],
  },
  derived: {
    total_tokens: 1234,
    duration: 61.5,
    task_args: "split=dev",
    percent_completed: 80,
    sample_limits: "context",
    scores: { grader: { accuracy: 0.5 }, judge: { accuracy: 0.9 } },
  },
};

const record = (overrides?: Record<string, unknown>): LogListingRow =>
  ({ ...baseRecord, ...overrides }) as unknown as LogListingRow;

/** Variants exercising the accessors' branches, not just the happy path. */
const records: Record<string, LogListingRow> = {
  full: record(),
  // Sentinel model hidden on both sides; first model role serves instead.
  sentinelModel: record({ model: "none/none" }),
  // Never-completed: both sides fall back to the file-name timestamp.
  neverCompleted: record({ completed_at: "", status: "started" }),
  // No task field: both sides parse the file name (a basename on one side,
  // a possibly-relative display name on the other).
  parsedTask: record({ task: undefined }),
  // Sparse legacy record: no details/derived tiers, no task_id.
  sparse: record({
    task_id: undefined,
    header: undefined,
    derived: undefined,
    primary_metric: undefined,
    completed_at: undefined,
    model_roles: undefined,
    retried: undefined,
  }),
};

const views: Record<string, FileLogItemView> = {
  folder: { mode: "logs", logDir: "/logs", currentDir: "/logs/sub" },
  tasks: { mode: "tasks", logDir: "/logs", currentDir: "/logs" },
};

describe("column schema / grid accessor parity", () => {
  test.each(
    Object.entries(views).flatMap(([viewName, view]) =>
      Object.keys(records).map(
        (recordName) => [viewName, recordName, view] as const
      )
    )
  )("%s view agrees on the %s record", (_viewName, recordName, view) => {
    const { result } = renderHook(() =>
      useLogListColumns(view.mode, undefined, "per-scorer")
    );
    const { columns, getValue, schema } = result.current;

    const log = records[recordName]!;
    const item = fileLogItem(log, view);
    expect(item).toBeDefined();
    const shaped = buildLogListRow(item!);

    const columnIds = columns
      .map((col) => col.id)
      .filter((id): id is string => id !== undefined);
    expect(columnIds.length).toBeGreaterThan(15);

    const fromSchema = Object.fromEntries(
      columnIds.map((id) => [id, schema.getValue(log, id)])
    );
    const fromGrid = Object.fromEntries(
      columnIds.map((id) => [id, getValue(shaped, id)])
    );
    expect(fromSchema).toEqual(fromGrid);

    // Search text too: the find band matches records below the interface
    // via schema.getSearchText, while loaded overlay rows match above via
    // the column defs' textValue (rowSearchText's per-column rule) — the
    // two must produce the same text per column.
    const searchFromSchema = Object.fromEntries(
      columnIds.map((id) => [id, schema.getSearchText(log, id)])
    );
    const searchFromGrid = Object.fromEntries(
      columnIds.map((id) => {
        const column = columns.find((col) => col.id === id)!;
        return [
          id,
          column.textValue
            ? column.textValue(shaped)
            : primitiveText(getValue(shaped, id)),
        ];
      })
    );
    expect(searchFromSchema).toEqual(searchFromGrid);
  });
});
