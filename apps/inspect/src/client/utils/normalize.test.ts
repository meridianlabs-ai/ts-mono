import { describe, expect, it } from "vitest";

import {
  normalizeEvalHeader,
  normalizeEvalLog,
  normalizeLogStart,
} from "./normalize";

const minimalEval = {
  task: "demo",
  task_id: "t1",
  run_id: "r1",
  created: "2024-11-05T13:32:37-05:00",
  model: "mockllm/model",
  dataset: {},
  config: {},
};

describe("normalizeEvalHeader", () => {
  it("throws on non-object input", () => {
    expect(() => normalizeEvalHeader("bad")).toThrow();
    expect(() => normalizeEvalHeader(null)).toThrow();
  });

  it("fills version/status and normalizes eval + plan", () => {
    const header = normalizeEvalHeader({ eval: minimalEval });
    expect(header.version).toBe(2);
    expect(header.status).toBe("started");
    expect(header.eval.task_args_passed).toEqual({});
    expect(header.plan).toEqual({ name: "plan", steps: [], config: {} });
    expect(header.results).toBeNull();
  });

  it("derives tags/metadata from the spec when absent (recompute mirror)", () => {
    const header = normalizeEvalHeader({
      eval: { ...minimalEval, tags: ["x"], metadata: { reviewer: "a" } },
    });
    expect(header.tags).toEqual(["x"]);
    expect(header.metadata).toEqual({ reviewer: "a" });
  });

  it("prefers explicit log-level tags/metadata over the spec's", () => {
    const header = normalizeEvalHeader({
      eval: { ...minimalEval, tags: ["spec"] },
      tags: ["log"],
      metadata: { from: "log" },
    });
    expect(header.tags).toEqual(["log"]);
    expect(header.metadata).toEqual({ from: "log" });
  });

  it("normalizes config_updates, dropping malformed entries", () => {
    const header = normalizeEvalHeader({
      eval: minimalEval,
      config_updates: [
        { changes: "bad" },
        {
          scope: "task",
          provenance: { timestamp: "t", author: "a", metadata: {} },
          changes: [{ name: "max_samples", config: "eval", value: 2 }],
        },
      ],
    });
    expect(header.config_updates).toHaveLength(1);
    expect(header.config_updates?.[0]?.changes[0]?.previous).toBeNull();
  });
});

describe("normalizeLogStart", () => {
  it("fills version and normalizes eval + plan", () => {
    const start = normalizeLogStart({ eval: minimalEval });
    expect(start.version).toBe(2);
    expect(start.eval.task_args_passed).toEqual({});
    expect(start.plan.name).toBe("plan");
  });

  it("throws on non-object input", () => {
    expect(() => normalizeLogStart(undefined)).toThrow();
  });
});

describe("normalizeEvalLog", () => {
  it("fills log-level defaults and normalizes samples", () => {
    const log = normalizeEvalLog({
      eval: minimalEval,
      samples: [
        {
          id: 1,
          epoch: 1,
          input: "q",
          events: [{ event: "model", timestamp: "t", model: "m" }],
        },
      ],
    });
    expect(log.version).toBe(2);
    expect(log.status).toBe("started");
    expect(log.invalidated).toBe(false);
    const event = log.samples?.[0]?.events[0];
    expect(event?.working_start).toBe(0);
    expect(event?.event === "model" && event.config).toEqual({});
  });

  it("leaves samples absent when the file carries none (header-only log)", () => {
    const log = normalizeEvalLog({ eval: minimalEval });
    expect(log.samples).toBeUndefined();
  });
});
