import { describe, expect, it } from "vitest";

import {
  ConfigUpdate,
  ConnectionLimitChange,
  EvalStats,
} from "@tsmono/inspect-common/types";

import { SampleSummary } from "../../../../client/api/types";

import { historyRows, sampleStatus } from "./timelineData";

const epoch = (iso: string): number => Date.parse(iso) / 1000;

const sample = (overrides: Partial<SampleSummary>): SampleSummary => ({
  id: 1,
  epoch: 1,
  input: "input",
  target: "target",
  scores: null,
  ...overrides,
});

describe("sampleStatus", () => {
  it("separates cancellations and still-running samples from errors", () => {
    expect(sampleStatus(sample({ error: "boom(oops)" }))).toBe("error");
    expect(sampleStatus(sample({ error: "CancelledError(cancelled)" }))).toBe(
      "cancelled"
    );
    expect(sampleStatus(sample({ completed: false }))).toBe("started");
    expect(sampleStatus(sample({ limit: "message" }))).toBe("limit");
    expect(sampleStatus(sample({}))).toBe("completed");
  });
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

  it("aggregates contiguous controller scaling runs per model", () => {
    const change = (
      model: string,
      reason: ConnectionLimitChange["reason"],
      old_limit: number,
      new_limit: number,
      timestamp: number
    ): ConnectionLimitChange => ({
      model,
      reason,
      old_limit,
      new_limit,
      timestamp,
    });
    const t = epoch("2026-07-20T18:26:00+00:00");
    const stats = {
      started_at: "2026-07-20T18:25:24+00:00",
      completed_at: "2026-07-20T18:27:16+00:00",
      connection_limit_history: [
        change("m1", "slow_start", 5, 10, t),
        // Another model's event must not break m1's contiguous run.
        change("m2", "slow_start", 5, 8, t + 1),
        change("m1", "slow_start", 10, 20, t + 2),
        change("m1", "rate_limit", 20, 10, t + 3),
        change("m1", "steady_state_up", 10, 12, t + 4),
        change("m1", "steady_state_up", 12, 14, t + 5),
      ],
    } as EvalStats;
    const rows = historyRows({ status: "success", stats, samples: [] }).filter(
      (row) => row.kind === "connections"
    );
    expect(rows).toEqual([
      {
        kind: "connections",
        time: t + 1,
        postRun: false,
        model: "m2",
        reason: "slow_start",
        from: 5,
        to: 8,
        count: 1,
      },
      {
        kind: "connections",
        time: t + 2,
        postRun: false,
        model: "m1",
        reason: "slow_start",
        from: 5,
        to: 20,
        count: 2,
      },
      {
        kind: "connections",
        time: t + 3,
        postRun: false,
        model: "m1",
        reason: "rate_limit",
        from: 20,
        to: 10,
        count: 1,
      },
      {
        kind: "connections",
        time: t + 5,
        postRun: false,
        model: "m1",
        reason: "steady_state_up",
        from: 10,
        to: 14,
        count: 2,
      },
    ]);
  });

  it("sorts a config ◆ before its manual controller echo at the same time", () => {
    const when = "2026-07-20T18:26:00+00:00";
    const stats = {
      started_at: "2026-07-20T18:25:24+00:00",
      completed_at: "2026-07-20T18:27:16+00:00",
      connection_limit_history: [
        {
          model: "m1",
          reason: "manual",
          old_limit: 10,
          new_limit: 20,
          timestamp: epoch(when),
        },
      ],
    } as EvalStats;
    const configUpdate = {
      scope: "eval",
      changes: [],
      provenance: { timestamp: when, author: "cteague" },
    } as unknown as ConfigUpdate;
    const rows = historyRows({
      status: "success",
      stats,
      configUpdates: [configUpdate],
      samples: [],
    });
    expect(rows.map((row) => row.kind)).toEqual([
      "runStart",
      "config",
      "connections",
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
