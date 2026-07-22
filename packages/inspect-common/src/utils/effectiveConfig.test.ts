import { describe, expect, it } from "vitest";

import type { ConfigUpdate, EvalConfig, GenerateConfig } from "../types";

import {
  effectiveEvalConfig,
  effectiveGenerateConfig,
  evalConfigChanges,
  generateConfigChanges,
} from "./effectiveConfig";

const update = (
  changes: ConfigUpdate["changes"],
  overrides?: Partial<Omit<ConfigUpdate, "changes">>
): ConfigUpdate => ({
  changes,
  scope: "task",
  provenance: {
    author: "asher",
    timestamp: "2026-07-18T10:05:00Z",
    metadata: {},
  },
  ...overrides,
});

describe("effectiveEvalConfig", () => {
  it("returns the launch config unchanged when there are no updates", () => {
    const launch: EvalConfig = { epochs: 1, max_samples: 5 };
    expect(effectiveEvalConfig(launch, undefined)).toEqual(launch);
    expect(effectiveEvalConfig(launch, null)).toEqual(launch);
    expect(effectiveEvalConfig(launch, [])).toEqual(launch);
  });

  it("folds changes in order, last write wins", () => {
    const launch: EvalConfig = { max_samples: 5 };
    const folded = effectiveEvalConfig(launch, [
      update([
        {
          config: "eval",
          name: "max_samples",
          value: 10,
          previous: 5,
          cleared: false,
        },
      ]),
      update([
        {
          config: "eval",
          name: "max_samples",
          value: 20,
          previous: 10,
          cleared: false,
        },
      ]),
    ]);
    expect(folded.max_samples).toBe(20);
  });

  it("does not mutate the launch config", () => {
    const launch: EvalConfig = { max_samples: 5 };
    effectiveEvalConfig(launch, [
      update([
        {
          config: "eval",
          name: "max_samples",
          value: 20,
          previous: 5,
          cleared: false,
        },
      ]),
    ]);
    expect(launch.max_samples).toBe(5);
  });

  it("restores the launch value on cleared", () => {
    const launch: EvalConfig = { time_limit: 3600 };
    const folded = effectiveEvalConfig(launch, [
      update([
        {
          config: "eval",
          name: "time_limit",
          value: 900,
          previous: 3600,
          cleared: false,
        },
      ]),
      update([
        {
          config: "eval",
          name: "time_limit",
          value: null,
          previous: 900,
          cleared: true,
        },
      ]),
    ]);
    expect(folded.time_limit).toBe(3600);
  });

  it("removes the field on cleared when it was unset at launch", () => {
    const launch: EvalConfig = {};
    const folded = effectiveEvalConfig(launch, [
      update([
        {
          config: "eval",
          name: "time_limit",
          value: 900,
          previous: null,
          cleared: false,
        },
      ]),
      update([
        {
          config: "eval",
          name: "time_limit",
          value: null,
          previous: 900,
          cleared: true,
        },
      ]),
    ]);
    expect("time_limit" in folded).toBe(false);
  });

  it("treats value: null as a real setting (limit lifted)", () => {
    const launch: EvalConfig = { message_limit: 50 };
    const folded = effectiveEvalConfig(launch, [
      update([
        {
          config: "eval",
          name: "message_limit",
          value: null,
          previous: 50,
          cleared: false,
        },
      ]),
    ]);
    expect(folded.message_limit).toBeNull();
  });

  it("skips unknown fields", () => {
    const launch: EvalConfig = { epochs: 1 };
    const folded = effectiveEvalConfig(launch, [
      update([
        {
          config: "eval",
          name: "not_a_real_knob",
          value: 42,
          previous: null,
          cleared: false,
        },
      ]),
    ]);
    expect(folded).toEqual(launch);
  });

  it("skips concurrency and generate changes", () => {
    const launch: EvalConfig = { max_samples: 5 };
    const folded = effectiveEvalConfig(launch, [
      update([
        {
          config: "concurrency",
          name: "anthropic/claude-3-7-sonnet",
          value: 25,
          previous: 10,
          cleared: false,
        },
        {
          config: "generate",
          name: "max_connections",
          value: 25,
          previous: 10,
          cleared: false,
        },
      ]),
    ]);
    expect(folded).toEqual(launch);
  });
});

describe("effectiveGenerateConfig", () => {
  it("folds generate changes only", () => {
    const launch: GenerateConfig = { max_connections: 10, temperature: 0 };
    const folded = effectiveGenerateConfig(launch, [
      update([
        {
          config: "generate",
          name: "max_connections",
          value: 25,
          previous: 10,
          cleared: false,
        },
        {
          config: "eval",
          name: "max_samples",
          value: 20,
          previous: 5,
          cleared: false,
        },
      ]),
    ]);
    expect(folded.max_connections).toBe(25);
    expect(folded.temperature).toBe(0);
    expect("max_samples" in folded).toBe(false);
  });
});

describe("evalConfigChanges", () => {
  it("returns last-wins per-knob change info", () => {
    const changes = evalConfigChanges([
      update([
        {
          config: "eval",
          name: "max_samples",
          value: 10,
          previous: 5,
          cleared: false,
        },
      ]),
      update(
        [
          {
            config: "eval",
            name: "max_samples",
            value: 20,
            previous: 10,
            cleared: false,
          },
          {
            config: "eval",
            name: "message_limit",
            value: null,
            previous: 50,
            cleared: false,
          },
        ],
        {
          scope: "process",
          provenance: {
            author: "jwhite",
            timestamp: "2026-07-18T10:05:44Z",
            reason: "Speed up remaining samples",
            metadata: { inherited: true },
          },
        }
      ),
    ]);

    const maxSamples = changes.get("max_samples");
    expect(maxSamples?.value).toBe(20);
    expect(maxSamples?.previous).toBe(10);
    expect(maxSamples?.scope).toBe("process");
    expect(maxSamples?.inherited).toBe(true);
    expect(maxSamples?.limitLifted).toBe(false);
    expect(maxSamples?.provenance.author).toBe("jwhite");

    const messageLimit = changes.get("message_limit");
    expect(messageLimit?.value).toBeNull();
    expect(messageLimit?.limitLifted).toBe(true);
    expect(messageLimit?.cleared).toBe(false);
  });

  it("marks cleared knobs and never marks them limit-lifted", () => {
    const changes = evalConfigChanges([
      update([
        {
          config: "eval",
          name: "time_limit",
          value: null,
          previous: 900,
          cleared: true,
        },
      ]),
    ]);
    const timeLimit = changes.get("time_limit");
    expect(timeLimit?.cleared).toBe(true);
    expect(timeLimit?.limitLifted).toBe(false);
  });

  it("excludes unknown fields and concurrency changes", () => {
    const changes = evalConfigChanges([
      update([
        {
          config: "eval",
          name: "not_a_real_knob",
          value: 1,
          previous: null,
          cleared: false,
        },
        {
          config: "concurrency",
          name: "anthropic/claude-3-7-sonnet",
          value: 25,
          previous: 10,
          cleared: false,
        },
      ]),
    ]);
    expect(changes.size).toBe(0);
  });
});

describe("generateConfigChanges", () => {
  it("keys generate changes by field name", () => {
    const changes = generateConfigChanges([
      update([
        {
          config: "generate",
          name: "max_connections",
          value: 25,
          previous: 10,
          cleared: false,
        },
      ]),
    ]);
    expect(changes.get("max_connections")?.value).toBe(25);
  });
});
