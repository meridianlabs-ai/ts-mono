import { describe, expect, it } from "vitest";

import type { SentinelStats } from "@tsmono/inspect-common/types";

import { notableSamples, type SentinelSampleSummary } from "./notableSamples";

const stats = (overrides: Partial<SentinelStats> = {}): SentinelStats => ({
  steps: { tool_call: { total: 2, judged: 2, unjudged: {} } },
  actions: { proceed: 2 },
  complete: true,
  ...overrides,
});

describe("notableSamples", () => {
  it("lists terminated, then unchecked, then left-out samples for one sentinel", () => {
    const samples: SentinelSampleSummary[] = [
      { id: "fine", epoch: 1, sentinel_stats: { guard: stats() } },
      {
        id: "partial",
        epoch: 1,
        sentinel_stats: {
          guard: stats({ complete: false, incomplete_reason: "cancelled" }),
        },
      },
      {
        id: "skipped",
        epoch: 2,
        sentinel_stats: {
          guard: stats({
            steps: {
              tool_call: { total: 3, judged: 1, unjudged: { cancelled: 2 } },
            },
          }),
        },
      },
      {
        id: "ended",
        epoch: 1,
        sentinel_stats: { guard: stats({ actions: { terminate: 1 } }) },
      },
      {
        id: "other",
        epoch: 1,
        sentinel_stats: { audit: stats({ actions: { terminate: 1 } }) },
      },
    ];
    expect(notableSamples(samples, "guard")).toEqual([
      {
        id: "ended",
        epoch: 1,
        status: "terminated",
        reason: "the sentinel ended the sample",
      },
      {
        id: "skipped",
        epoch: 2,
        status: "not checked",
        reason: "2 steps · cancelled before judging finished",
      },
      {
        id: "partial",
        epoch: 1,
        status: "left out",
        reason: "sentinel data incomplete · not in the numbers above",
      },
    ]);
  });
});
