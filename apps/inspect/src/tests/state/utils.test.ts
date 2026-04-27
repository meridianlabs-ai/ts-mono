import { describe, expect, test } from "vitest";

import { SampleSummary } from "../../client/api/types";
import { mergeSampleSummaries } from "../../state/utils";

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
