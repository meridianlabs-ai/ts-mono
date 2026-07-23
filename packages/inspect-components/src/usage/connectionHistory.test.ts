import { describe, expect, it } from "vitest";

import type {
  ConfigUpdate,
  ConnectionLimitChange,
} from "@tsmono/inspect-common/types";

import {
  adaptiveMaxFromConfig,
  buildConnectionLanes,
  capFromRetune,
  capGuideSegments,
  type ConnectionLaneData,
  connectionWindow,
  laneCapValues,
  type PoolRetune,
  poolRetunes,
} from "./connectionHistory";

const change = (
  overrides: Partial<ConnectionLimitChange> &
    Pick<ConnectionLimitChange, "timestamp" | "old_limit" | "new_limit">
): ConnectionLimitChange => ({
  model: "openai/gpt-4o",
  reason: "slow_start",
  ...overrides,
});

describe("connectionWindow", () => {
  it("returns undefined for empty or missing history", () => {
    expect(connectionWindow(undefined)).toBeUndefined();
    expect(connectionWindow([])).toBeUndefined();
  });

  it("uses eval start/end when they bound the events", () => {
    const history = [change({ timestamp: 1000, old_limit: 20, new_limit: 40 })];
    const window = connectionWindow(
      history,
      new Date(500 * 1000).toISOString(),
      new Date(2000 * 1000).toISOString()
    );
    expect(window).toEqual({ start: 500, end: 2000 });
  });

  it("expands to cover events outside the eval bounds", () => {
    const history = [
      change({ timestamp: 100, old_limit: 20, new_limit: 40 }),
      change({ timestamp: 3000, old_limit: 40, new_limit: 80 }),
    ];
    const window = connectionWindow(
      history,
      new Date(500 * 1000).toISOString(),
      new Date(2000 * 1000).toISOString()
    );
    expect(window).toEqual({ start: 100, end: 3000 });
  });

  it("falls back to the event range for live evals", () => {
    const history = [
      change({ timestamp: 1000, old_limit: 20, new_limit: 40 }),
      change({ timestamp: 1500, old_limit: 40, new_limit: 80 }),
    ];
    const window = connectionWindow(
      history,
      new Date(800 * 1000).toISOString(),
      ""
    );
    expect(window).toEqual({ start: 800, end: 1500 });
  });
});

describe("buildConnectionLanes", () => {
  it("groups by model and derives start/peak/final/rate limits", () => {
    const history = [
      change({ timestamp: 100, old_limit: 20, new_limit: 40 }),
      change({
        timestamp: 200,
        old_limit: 40,
        new_limit: 32,
        reason: "rate_limit",
      }),
      change({
        model: "anthropic/claude-sonnet-4-5",
        timestamp: 150,
        old_limit: 20,
        new_limit: 60,
      }),
    ];
    const lanes = buildConnectionLanes(history, { start: 0, end: 400 });
    expect(Object.keys(lanes).sort()).toEqual([
      "anthropic/claude-sonnet-4-5",
      "openai/gpt-4o",
    ]);
    const gpt = lanes["openai/gpt-4o"]!;
    expect(gpt.start).toBe(20);
    expect(gpt.peak).toBe(40);
    expect(gpt.final).toBe(32);
    expect(gpt.rateLimitCount).toBe(1);
    expect(lanes["anthropic/claude-sonnet-4-5"]!.rateLimitCount).toBe(0);
  });

  it("sorts events by timestamp before deriving", () => {
    const history = [
      change({ timestamp: 200, old_limit: 40, new_limit: 80 }),
      change({ timestamp: 100, old_limit: 20, new_limit: 40 }),
    ];
    const lane = buildConnectionLanes(history, { start: 0, end: 300 })[
      "openai/gpt-4o"
    ]!;
    expect(lane.start).toBe(20);
    expect(lane.final).toBe(80);
    expect(lane.events.map((e) => e.timestamp)).toEqual([100, 200]);
  });

  it("computes a time-weighted average over the window", () => {
    // 20 for [0,100), 40 for [100,200), 80 for [200,400) → avg = 55
    const history = [
      change({ timestamp: 100, old_limit: 20, new_limit: 40 }),
      change({ timestamp: 200, old_limit: 40, new_limit: 80 }),
    ];
    const lane = buildConnectionLanes(history, { start: 0, end: 400 })[
      "openai/gpt-4o"
    ]!;
    expect(lane.avg).toBe(55);
  });

  it("clamps event timestamps to the window when averaging", () => {
    const history = [change({ timestamp: 50, old_limit: 20, new_limit: 40 })];
    const lane = buildConnectionLanes(history, { start: 100, end: 200 })[
      "openai/gpt-4o"
    ]!;
    expect(lane.avg).toBe(40);
  });

  it("resolves configured max per model", () => {
    const history = [change({ timestamp: 100, old_limit: 20, new_limit: 40 })];
    const lanes = buildConnectionLanes(
      history,
      { start: 0, end: 200 },
      () => 64
    );
    expect(lanes["openai/gpt-4o"]!.configuredMax).toBe(64);
  });

  it("returns empty for empty history or missing window", () => {
    expect(buildConnectionLanes([], { start: 0, end: 1 })).toEqual({});
    expect(
      buildConnectionLanes(
        [change({ timestamp: 1, old_limit: 1, new_limit: 2 })],
        undefined
      )
    ).toEqual({});
  });
});

describe("adaptiveMaxFromConfig", () => {
  it("handles absent/disabled config", () => {
    expect(adaptiveMaxFromConfig(undefined)).toBeUndefined();
    expect(adaptiveMaxFromConfig({})).toBeUndefined();
    expect(
      adaptiveMaxFromConfig({ adaptive_connections: false })
    ).toBeUndefined();
    expect(
      adaptiveMaxFromConfig({ adaptive_connections: null })
    ).toBeUndefined();
  });

  it("uses the schema default max for `true`", () => {
    expect(adaptiveMaxFromConfig({ adaptive_connections: true })).toBe(100);
  });

  it("treats a bare number as the max", () => {
    expect(adaptiveMaxFromConfig({ adaptive_connections: 50 })).toBe(50);
  });

  it("parses string shorthands", () => {
    expect(adaptiveMaxFromConfig({ adaptive_connections: "10-80" })).toBe(80);
    expect(adaptiveMaxFromConfig({ adaptive_connections: "10-20-120" })).toBe(
      120
    );
  });

  it("reads max from an AdaptiveConcurrency object", () => {
    expect(
      adaptiveMaxFromConfig({ adaptive_connections: { min: 5, max: 40 } })
    ).toBe(40);
    expect(adaptiveMaxFromConfig({ adaptive_connections: {} })).toBe(100);
  });
});

const update = (
  changes: ConfigUpdate["changes"],
  timestamp = "2026-07-18T10:05:00Z"
): ConfigUpdate => ({
  changes,
  scope: "task",
  provenance: { author: "asher", timestamp, metadata: {} },
});

const retune = (overrides: Partial<PoolRetune>): PoolRetune => ({
  timestamp: 100,
  name: "max_connections",
  previous: 20,
  value: 40,
  cleared: false,
  author: "asher",
  ...overrides,
});

const lane = (overrides: Partial<ConnectionLaneData>): ConnectionLaneData => ({
  model: "openai/gpt-4o",
  events: [],
  start: 10,
  peak: 10,
  final: 10,
  avg: 10,
  rateLimitCount: 0,
  ...overrides,
});

describe("poolRetunes", () => {
  it("keys concurrency changes on the registry name", () => {
    const byModel = poolRetunes([
      update([
        {
          config: "concurrency",
          name: "anthropic/claude-sonnet-4-5",
          value: 25,
          previous: 10,
          cleared: false,
        },
      ]),
    ]);
    expect(Object.keys(byModel)).toEqual(["anthropic/claude-sonnet-4-5"]);
    expect(byModel["anthropic/claude-sonnet-4-5"]![0]!.value).toBe(25);
  });

  it("routes generate pool knobs to the main model only", () => {
    const updates = [
      update([
        {
          config: "generate",
          name: "max_connections",
          value: 50,
          previous: 20,
          cleared: false,
        },
        {
          config: "generate",
          name: "temperature",
          value: 1,
          previous: 0,
          cleared: false,
        },
        {
          config: "eval",
          name: "max_samples",
          value: 8,
          previous: 4,
          cleared: false,
        },
      ]),
    ];
    const byModel = poolRetunes(updates, "openai/gpt-4o");
    expect(Object.keys(byModel)).toEqual(["openai/gpt-4o"]);
    expect(byModel["openai/gpt-4o"]!.map((r) => r.name)).toEqual([
      "max_connections",
    ]);
    // Without a main model there is nowhere to attach generate retunes.
    expect(poolRetunes(updates)).toEqual({});
  });

  it("sorts by timestamp and drops unparseable provenance timestamps", () => {
    const byModel = poolRetunes(
      [
        update(
          [
            {
              config: "generate",
              name: "max_connections",
              value: 50,
              previous: 20,
              cleared: false,
            },
          ],
          "2026-07-18T11:00:00Z"
        ),
        update(
          [
            {
              config: "generate",
              name: "max_connections",
              value: 30,
              previous: 20,
              cleared: false,
            },
          ],
          "not-a-timestamp"
        ),
        update(
          [
            {
              config: "generate",
              name: "max_connections",
              value: 40,
              previous: 20,
              cleared: false,
            },
          ],
          "2026-07-18T10:00:00Z"
        ),
      ],
      "openai/gpt-4o"
    );
    expect(byModel["openai/gpt-4o"]!.map((r) => r.value)).toEqual([40, 50]);
  });

  it("carries cleared through to the retune", () => {
    const byModel = poolRetunes(
      [
        update([
          {
            config: "generate",
            name: "max_connections",
            value: null,
            previous: 50,
            cleared: true,
          },
        ]),
      ],
      "openai/gpt-4o"
    );
    expect(byModel["openai/gpt-4o"]![0]!.cleared).toBe(true);
  });
});

describe("capFromRetune", () => {
  it("restores the launch cap on cleared, 'none' without one", () => {
    const cleared = retune({ cleared: true, value: null });
    expect(capFromRetune(cleared, 64)).toBe(64);
    expect(capFromRetune(cleared)).toBe("none");
  });

  it("parses adaptive_connections values", () => {
    const adaptive = (value: unknown) =>
      capFromRetune(retune({ name: "adaptive_connections", value }));
    expect(adaptive(true)).toBe(100);
    expect(adaptive("10-80")).toBe(80);
    expect(adaptive({ min: 2, max: 50 })).toBe(50);
    // Adaptive disabled — the cap ceases to exist.
    expect(adaptive(false)).toBe("none");
    expect(adaptive(null)).toBe("none");
  });

  it("steps to numeric values and ends the cap on null", () => {
    expect(capFromRetune(retune({ value: 50 }))).toBe(50);
    expect(capFromRetune(retune({ value: null }))).toBe("none");
    expect(capFromRetune(retune({ value: "fast" }))).toBeUndefined();
  });
});

describe("capGuideSegments", () => {
  const x = (t: number) => t;

  it("steps the guide at retunes that changed the cap", () => {
    const segments = capGuideSegments(
      lane({ configuredMax: 20 }),
      [retune({ timestamp: 100, value: 50 })],
      400,
      x,
      0,
      400
    );
    expect(segments).toEqual([
      { x1: 0, x2: 100, value: 20 },
      { x1: 100, x2: 400, value: 50 },
    ]);
  });

  it("ignores post-run retunes past the window end", () => {
    const segments = capGuideSegments(
      lane({ configuredMax: 20 }),
      [retune({ timestamp: 900, value: 500 })],
      400,
      x,
      0,
      400
    );
    expect(segments).toEqual([{ x1: 0, x2: 400, value: 20 }]);
  });

  it("ends the guide on a 'none' step until a cap returns", () => {
    const segments = capGuideSegments(
      lane({}),
      [
        retune({
          timestamp: 100,
          name: "adaptive_connections",
          value: 50,
        }),
        retune({
          timestamp: 200,
          name: "adaptive_connections",
          value: null,
          previous: 50,
          cleared: true,
        }),
        retune({ timestamp: 300, value: 30 }),
      ],
      400,
      x,
      0,
      400
    );
    // No launch cap: nothing before 100, capped 100→200, gone until 300.
    expect(segments).toEqual([
      { x1: 100, x2: 200, value: 50 },
      { x1: 300, x2: 400, value: 30 },
    ]);
  });
});

describe("laneCapValues", () => {
  it("collects numeric in-window caps only", () => {
    const values = laneCapValues(
      lane({ configuredMax: 20 }),
      [
        retune({ timestamp: 100, value: 50 }),
        retune({ timestamp: 200, name: "adaptive_connections", value: false }),
        retune({ timestamp: 900, value: 500 }),
      ],
      400
    );
    expect(values).toEqual([50]);
  });
});
