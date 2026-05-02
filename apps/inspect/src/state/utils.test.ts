import { describe, expect, test } from "vitest";

import { SampleSummary } from "../client/api/types";

import { mergeSampleSummaries } from "./utils";

describe("mergeSampleSummaries", () => {
  test("keeps pending-only completed samples on the streaming path", () => {
    const result = mergeSampleSummaries(
      [],
      [createSampleSummary({ completed: true })]
    );

    expect(result).toHaveLength(1);
    expect(result[0].completed).toBe(false);
  });

  test("prefers log summaries over pending summaries for the same sample", () => {
    const logSummary = createSampleSummary({
      input: "from log",
      completed: true,
    });
    const pendingSummary = createSampleSummary({
      input: "from pending",
      completed: false,
    });

    expect(mergeSampleSummaries([logSummary], [pendingSummary])).toEqual([
      logSummary,
    ]);
  });

  test("preserves completed:true for pending samples that errored before any work", () => {
    const result = mergeSampleSummaries(
      [],
      [
        createSampleSummary({
          id: "errored-before-start",
          completed: true,
          error: "RuntimeError: server.py exited before becoming ready",
        }),
      ]
    );

    expect(result).toHaveLength(1);
    expect(result[0].completed).toBe(true);
    expect(result[0].error).toBe(
      "RuntimeError: server.py exited before becoming ready"
    );
  });
});

const createSampleSummary = (
  overrides: Partial<SampleSummary> = {}
): SampleSummary => ({
  id: "it_has_begun (hard)",
  epoch: 1,
  input: "input",
  target: "target",
  scores: null,
  ...overrides,
});
