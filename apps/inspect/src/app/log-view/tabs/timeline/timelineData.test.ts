import { describe, expect, it } from "vitest";

import { EvalStats } from "@tsmono/inspect-common/types";

import { SampleSummary } from "../../../../client/api/types";

import { historyRows } from "./timelineData";

const sample = (overrides: Partial<SampleSummary>): SampleSummary => ({
  id: 1,
  epoch: 1,
  input: "input",
  target: "target",
  scores: null,
  ...overrides,
});

describe("historyRows", () => {
  it("sorts run lifecycle rows around timestamp ties", () => {
    const stats = {
      started_at: "2026-07-20T18:25:24+00:00",
      completed_at: "2026-07-20T18:27:16+00:00",
    } as EvalStats;
    const rows = historyRows({
      status: "success",
      stats,
      samples: [
        // Terminates at the exact runEnd timestamp — its limit row must
        // still sort before "Run completed".
        sample({
          limit: "message",
          completed_at: stats.completed_at,
        }),
        // And an error at the exact runStart timestamp sorts after
        // "Run started".
        sample({
          id: 2,
          error: "boom",
          completed_at: stats.started_at,
        }),
      ],
    });
    expect(rows.map((row) => row.kind)).toEqual([
      "runStart",
      "sampleError",
      "sampleLimit",
      "runEnd",
    ]);
  });

  it("keeps runEnd last when clock skew stamps a sample past run end", () => {
    const stats = {
      started_at: "2026-07-20T18:25:24+00:00",
      completed_at: "2026-07-20T18:27:16+00:00",
    } as EvalStats;
    const rows = historyRows({
      status: "success",
      stats,
      samples: [
        sample({
          limit: "message",
          completed_at: "2026-07-20T18:27:16.400+00:00",
        }),
      ],
    });
    expect(rows.map((row) => row.kind)).toEqual([
      "runStart",
      "sampleLimit",
      "runEnd",
    ]);
  });
});
