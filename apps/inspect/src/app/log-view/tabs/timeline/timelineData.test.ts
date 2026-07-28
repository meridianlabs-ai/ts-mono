import { describe, expect, it } from "vitest";

import {
  ConfigUpdate,
  ConnectionLimitChange,
  EvalStats,
  LogUpdate,
} from "@tsmono/inspect-common/types";

import { SampleSummary } from "../../../../client/api/types";

import {
  configMarkers,
  densestTerminationBin,
  dotLadderStep,
  fmtDuration,
  HistoryRow,
  historyRows,
  logMarkers,
  rowCategory,
  rowHaystack,
  sampleStatus,
  Termination,
  withConfigOrdinals,
} from "./timelineData";

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

describe("dotLadderStep", () => {
  it("steps down the 3-step ladder and floors at r = 1.5", () => {
    expect(dotLadderStep(1)).toEqual({ r: 3.5, pitch: 9 });
    expect(dotLadderStep(12)).toEqual({ r: 3.5, pitch: 9 });
    expect(dotLadderStep(13)).toEqual({ r: 2.2, pitch: 6 });
    expect(dotLadderStep(28)).toEqual({ r: 2.2, pitch: 6 });
    expect(dotLadderStep(29)).toEqual({ r: 1.5, pitch: 4 });
    // Past the floor the band grows instead — the step never changes.
    expect(dotLadderStep(500)).toEqual({ r: 1.5, pitch: 4 });
  });
});

describe("densestTerminationBin", () => {
  const dot = (time: number): Termination => ({
    time,
    status: "completed",
    sample: sample({}),
  });

  it("counts the densest uniform time slice", () => {
    // 150 slices over 1500s → 10s slices: three dots share one slice.
    const window = { start: 0, end: 1500 };
    const dots = [dot(101), dot(105), dot(109), dot(500)];
    expect(densestTerminationBin(dots, window)).toBe(3);
  });

  it("degrades to the dot count on an empty window", () => {
    const window = { start: 5, end: 5 };
    expect(densestTerminationBin([dot(5), dot(5)], window)).toBe(2);
  });
});

describe("rowCategory", () => {
  const base = { time: 0, postRun: false };
  const configUpdate = {
    scope: "task",
    changes: [
      {
        config: "eval",
        name: "max_samples",
        previous: 20,
        value: 32,
        cleared: false,
      },
    ],
    provenance: {
      timestamp: "2026-07-20T18:26:00+00:00",
      author: "charles@meridianlabs.ai",
      reason: "raising concurrency",
      metadata: {},
    },
  } as ConfigUpdate;

  it("splits the old Runtime junk drawer into limits, errors, and run", () => {
    expect(
      rowCategory({ ...base, kind: "sampleLimit", sample: sample({}) })
    ).toBe("limits");
    expect(
      rowCategory({ ...base, kind: "sampleError", sample: sample({}) })
    ).toBe("errors");
    expect(
      rowCategory({ ...base, kind: "fallback", sample: sample({}), line: "" })
    ).toBe("errors");
    expect(rowCategory({ ...base, kind: "runStart", detail: "" })).toBe("run");
    expect(
      rowCategory({ ...base, kind: "runEnd", status: "success", detail: "" })
    ).toBe("run");
    expect(
      rowCategory({
        ...base,
        kind: "connections",
        model: "m1",
        reason: "manual",
        from: 5,
        to: 10,
        count: 1,
      })
    ).toBe("connections");
    expect(
      rowCategory({ ...base, kind: "config", update: configUpdate, index: 0 })
    ).toBe("config");
  });

  it("builds a search haystack from knob path, sample id, and author", () => {
    const row: HistoryRow = {
      ...base,
      kind: "config",
      update: configUpdate,
      index: 0,
    };
    const haystack = rowHaystack(row).toLowerCase();
    expect(haystack).toContain("eval.max_samples");
    expect(haystack).toContain("charles@meridianlabs.ai");
    expect(haystack).toContain("raising concurrency");
    expect(
      rowHaystack({ ...base, kind: "sampleLimit", sample: sample({ id: 33 }) })
    ).toContain("sample 33");
  });
});

describe("withConfigOrdinals", () => {
  const configUpdate = (timestamp: string): ConfigUpdate =>
    ({
      scope: "task",
      changes: [],
      provenance: { timestamp, author: "a", metadata: {} },
    }) as unknown as ConfigUpdate;

  it("numbers config markers chronologically, skipping tag edits", () => {
    const config = configMarkers(
      [
        configUpdate("2026-07-20T18:26:02+00:00"),
        configUpdate("2026-07-20T18:26:00+00:00"),
      ],
      undefined
    );
    const logs = logMarkers(
      [
        {
          edits: [{ type: "tags", tags_add: ["t"], tags_remove: [] }],
          provenance: {
            timestamp: "2026-07-20T18:26:01+00:00",
            author: "a",
            metadata: {},
          },
        },
      ],
      undefined
    );
    const markers = withConfigOrdinals(
      [...config, ...logs].sort((a, b) => a.time - b.time)
    );
    // configMarkers sorts by time, so the update at :00 is ordinal 1 even
    // though it was recorded second; the tag edit between stays unnumbered.
    expect(markers.map((m) => [m.kind, m.ordinal])).toEqual([
      ["config", 1],
      ["log", undefined],
      ["config", 2],
    ]);
  });
});

describe("configMarkers", () => {
  it("skips journal entries whose changes is missing or not an array", () => {
    // Journal entries are cast, not validated — a malformed `changes` must
    // degrade to a skip (matching effectiveConfig) in both the markers and
    // the History rows.
    const good = {
      scope: "task",
      changes: [
        {
          config: "eval",
          name: "max_samples",
          previous: 4,
          value: 8,
          cleared: false,
        },
      ],
      provenance: {
        timestamp: "2026-07-20T18:26:00+00:00",
        author: "a",
        metadata: {},
      },
    } as ConfigUpdate;
    const malformed = {
      scope: "task",
      changes: "not-an-array",
      provenance: {
        timestamp: "2026-07-20T18:26:01+00:00",
        author: "a",
        metadata: {},
      },
    } as unknown as ConfigUpdate;
    expect(configMarkers([good, malformed]).map((m) => m.index)).toEqual([0]);
    const rows = historyRows({
      configUpdates: [good, malformed],
      samples: [],
    });
    expect(rows.map((row) => row.kind)).toEqual(["config"]);
  });
});

describe("logMarkers", () => {
  it("skips log updates whose edits is missing or not an array", () => {
    // Same cast-not-validated posture as configMarkers' `changes` guard.
    const good: LogUpdate = {
      edits: [{ type: "tags", tags_add: ["t"], tags_remove: [] }],
      provenance: {
        timestamp: "2026-07-20T18:26:00+00:00",
        author: "a",
        metadata: {},
      },
    };
    const malformed = {
      edits: "not-an-array",
      provenance: {
        timestamp: "2026-07-20T18:26:01+00:00",
        author: "a",
        metadata: {},
      },
    } as unknown as LogUpdate;
    expect(
      logMarkers([good, malformed], undefined).map((m) => m.index)
    ).toEqual([0]);
    const rows = historyRows({
      logUpdates: [good, malformed],
      samples: [],
    });
    expect(rows.map((row) => row.kind)).toEqual(["logUpdate"]);
  });
});

describe("fmtDuration", () => {
  it("carries rounding into minutes and adds hours", () => {
    expect(fmtDuration(119.6)).toBe("2:00");
    expect(fmtDuration(34)).toBe("0:34");
    expect(fmtDuration(7234)).toBe("2:00:34");
    expect(fmtDuration(undefined)).toBe("—");
    expect(fmtDuration(null)).toBe("—");
    // Negative input is corrupt/clock-skewed data, not a duration.
    expect(fmtDuration(-5)).toBe("—");
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
