import { describe, expect, it } from "vitest";

import type { LogListingRow } from "../logListing";
import type { ScorerMap } from "../scoreSchema";

import { createLogColumnSchema } from "./logColumnSchema";

const record = (overrides?: Partial<LogListingRow>): LogListingRow =>
  ({
    name: "/logs/sub/2024-01-05T10-00-00+00-00_task_abc.eval",
    ...overrides,
  }) as LogListingRow;

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
  "labeler/verdict": {
    scorerName: "labeler",
    metricName: "verdict",
    valueType: "string",
  },
};

describe("createLogColumnSchema", () => {
  const schema = createLogColumnSchema(scorerMap);

  it("resolves membership columns against the record", () => {
    expect(schema.getValue(record(), "parent_dir")).toBe("/logs/sub");
    // Total: a missing mark reads as false (the retried = false condition
    // must keep task-id-less logs).
    expect(schema.getValue(record(), "retried")).toBe(false);
    expect(schema.getValue(record({ retried: true }), "retried")).toBe(true);
    expect(schema.getFilterType("retried")).toBe("boolean");
  });

  it("hides the sentinel model and falls back to the first model role", () => {
    expect(schema.getValue(record({ model: "gpt-4" }), "model")).toBe("gpt-4");
    // A declared column must answer for itself — a raw-field fallthrough
    // would resurface the sentinel here.
    expect(
      schema.getValue(
        record({ model: "none/none", model_roles: { grader: "gpt-4o" } }),
        "model"
      )
    ).toBe("gpt-4o");
  });

  it("falls back to the file-name timestamp for never-completed logs", () => {
    expect(
      schema.getValue(
        record({ completed_at: "2024-02-01T00:00:00Z" }),
        "completedAt"
      )
    ).toBe("2024-02-01T00:00:00Z");
    expect(schema.getValue(record({ completed_at: "" }), "completedAt")).toBe(
      new Date("2024-01-05T10:00:00+00:00").toISOString()
    );
  });

  it("derives task from the file name when the record has none", () => {
    expect(schema.getValue(record({ task: "explicit" }), "task")).toBe(
      "explicit"
    );
    expect(schema.getValue(record(), "task")).toBe("task");
  });

  it("resolves per-scorer and by-metric score columns from derived scores", () => {
    const log = record({
      derived: {
        scores: { grader: { accuracy: 0.5 }, judge: { accuracy: 0.9 } },
      },
    });
    expect(schema.getValue(log, "score_judge/accuracy")).toBe(0.9);
    expect(schema.getValue(log, "score_grader/accuracy")).toBe(0.5);
    // By-metric: first non-empty value in alphabetical scorer order.
    expect(schema.getValue(log, "metric_accuracy")).toBe(0.5);
    expect(schema.getFilterType("score_grader/accuracy")).toBe("number");
    expect(schema.getFilterType("metric_accuracy")).toBe("number");
    expect(schema.getComparator("metric_accuracy")).toBeDefined();
    // Mixed/string metrics keep the default compare and string filtering.
    expect(schema.getComparator("metric_verdict")).toBeUndefined();
    expect(schema.getFilterType("metric_verdict")).toBe("string");
  });

  it("reads unknown column ids as raw record fields", () => {
    expect(schema.getValue(record({ task_id: "t-1" }), "task_id")).toBe("t-1");
    expect(schema.getFilterType("task_id")).toBe("string");
  });

  it("keys the schema by the scorer map", () => {
    expect(schema.key).toBe(
      "grader/accuracy:number,judge/accuracy:number,labeler/verdict:string"
    );
    expect(createLogColumnSchema({}).key).toBe("");
  });
});
