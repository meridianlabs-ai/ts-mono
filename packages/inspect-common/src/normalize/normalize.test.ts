import { describe, expect, it } from "vitest";

import type { ModelEvent, StateEvent } from "../types";

import legacyHeader from "./fixtures/legacy-header-2024-11.json";
import legacySample from "./fixtures/legacy-sample-2024-11.json";
import {
  normalizeConfigUpdates,
  normalizeEvalPlan,
  normalizeEvalResults,
  normalizeEvalSample,
  normalizeEvalSpec,
  normalizeEvent,
  normalizeEvents,
} from "./index";

describe("normalizeEvalSample on a real Nov-2024 log", () => {
  const sample = normalizeEvalSample(legacySample);

  it("fills working_start on every event", () => {
    expect(sample.events.length).toBeGreaterThan(0);
    for (const event of sample.events) {
      expect(event.working_start).toBe(0);
    }
  });

  it("fills read-time defaults the 2024 writer didn't emit", () => {
    expect(sample.role_usage).toEqual({});
    expect(sample.output.completion).toBe("");
  });

  it("fills model-event output completion while preserving content", () => {
    const modelEvent = sample.events.find(
      (event): event is ModelEvent => event.event === "model"
    );
    expect(modelEvent).toBeDefined();
    expect(modelEvent!.output.completion).toBe("");
    expect(modelEvent!.output.model).toBeTruthy();
    expect(modelEvent!.output.choices.length).toBeGreaterThan(0);
    expect(modelEvent!.config).toBeDefined();
  });

  it("preserves fields that were present", () => {
    expect(sample.id).toEqual((legacySample as { id: unknown }).id);
    expect(sample.messages.length).toBe(legacySample.messages.length);
    expect(sample.events.length).toBe(legacySample.events.length);
  });
});

describe("normalize header pieces on a real Nov-2024 log", () => {
  it("fills EvalSpec migrations and defaults", () => {
    const spec = normalizeEvalSpec(legacyHeader.eval);
    expect(spec.task_args_passed).toEqual(legacyHeader.eval.task_args);
    // eval_id predates this log; synthesized from run_id + task_id + created
    expect(spec.eval_id).toContain(legacyHeader.eval.run_id);
    expect(spec.model_generate_config).toEqual({});
    expect(spec.task).toBe(legacyHeader.eval.task);
  });

  it("passes through the already-complete results and plan", () => {
    const results = normalizeEvalResults(legacyHeader.results);
    expect(results?.scores.length).toBe(legacyHeader.results.scores.length);
    const plan = normalizeEvalPlan(legacyHeader.plan);
    expect(plan.name).toBe(legacyHeader.plan.name);
  });

  it("returns null results for in-progress logs", () => {
    expect(normalizeEvalResults(undefined)).toBeNull();
    expect(normalizeEvalResults(null)).toBeNull();
  });
});

describe("legacy shape migrations", () => {
  it("lifts transcript into events + attachments", () => {
    const sample = normalizeEvalSample({
      id: 1,
      epoch: 1,
      input: "q",
      target: "a",
      transcript: {
        events: [{ event: "step", action: "begin", name: "solve" }],
        content: { att1: "value" },
      },
    });
    expect(sample.events.map((event) => event.event)).toEqual(["step"]);
    expect(sample.attachments).toEqual({ att1: "value" });
    expect("transcript" in sample).toBe(false);
  });

  it("lifts a single score into the scores map", () => {
    const sample = normalizeEvalSample({
      id: 1,
      epoch: 1,
      input: "q",
      target: "a",
      score: { value: "C" },
    });
    expect(sample.scores).toEqual({ scorer: { value: "C" } });
  });

  it("migrates a sandbox tuple to a spec object", () => {
    const spec = normalizeEvalSpec({
      task: "t",
      sandbox: ["docker", "compose.yaml"],
    });
    expect(spec.sandbox).toEqual({ type: "docker", config: "compose.yaml" });
  });
});

describe("normalizeEvents", () => {
  it("drops non-event entries and keeps unknown event kinds", () => {
    const events = normalizeEvents([
      null,
      "garbage",
      { no_event_tag: true },
      { event: "from_the_future", timestamp: "t", working_start: 1 },
      { event: "step", action: "begin", name: "solve" },
    ]);
    expect(events.map((event) => event.event)).toEqual([
      "from_the_future",
      "step",
    ]);
  });

  it("returns [] for a non-array", () => {
    expect(normalizeEvents(undefined)).toEqual([]);
    expect(normalizeEvents({ events: [] })).toEqual([]);
  });

  it("returns the same object when nothing needs filling", () => {
    const event = {
      event: "state",
      timestamp: "2025-01-01T00:00:00Z",
      working_start: 1.5,
      changes: [],
    };
    expect(normalizeEvent(event)).toBe(event);
  });

  it("fills model-event structure crafted logs omit", () => {
    const event = normalizeEvent({
      event: "model",
      timestamp: "t",
      model: "m",
    }) as ModelEvent;
    expect(event.working_start).toBe(0);
    expect(event.config).toEqual({});
    expect(event.output).toEqual({ model: "", choices: [], completion: "" });
    expect(event.input).toEqual([]);
    expect(event.tools).toEqual([]);
  });

  it("fills usage token counts when usage is present but partial", () => {
    const event = normalizeEvent({
      event: "model",
      timestamp: "t",
      working_start: 0,
      model: "m",
      config: {},
      input: [],
      tools: [],
      tool_choice: "auto",
      output: { model: "m", choices: [], completion: "", usage: {} },
    }) as ModelEvent;
    expect(event.output.usage).toEqual({
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
    });
  });

  it("fills malformed state-event changes with an empty array", () => {
    const event = normalizeEvent({
      event: "state",
      timestamp: "t",
      working_start: 0,
      changes: "not-an-array",
    }) as StateEvent;
    expect(event.changes).toEqual([]);
  });
});

describe("normalizeConfigUpdates", () => {
  const provenance = {
    timestamp: "2025-01-01T00:00:00Z",
    author: "someone",
    metadata: {},
  };

  it("drops entries whose changes isn't an array", () => {
    const updates = normalizeConfigUpdates([
      { scope: "task", provenance, changes: "bad" },
      null,
      { scope: "task", provenance, changes: [] },
    ]);
    expect(updates.length).toBe(1);
  });

  it("drops non-object change rows and fills per-change defaults", () => {
    const updates = normalizeConfigUpdates([
      {
        scope: "task",
        provenance,
        changes: [
          null,
          "bad",
          { name: "max_samples", config: "eval", value: 5 },
        ],
      },
    ]);
    expect(updates[0]?.changes).toEqual([
      {
        name: "max_samples",
        config: "eval",
        value: 5,
        cleared: false,
        previous: null,
      },
    ]);
  });

  it("fills missing provenance so downstream reads are unguarded", () => {
    const updates = normalizeConfigUpdates([{ scope: "process", changes: [] }]);
    expect(updates[0]?.provenance).toEqual({
      timestamp: "",
      author: "",
      metadata: {},
    });
  });

  it("returns [] for non-arrays", () => {
    expect(normalizeConfigUpdates(undefined)).toEqual([]);
    expect(normalizeConfigUpdates("bad")).toEqual([]);
  });
});

describe("normalizeEvalSample input validation", () => {
  it("throws on non-object sample data", () => {
    expect(() => normalizeEvalSample("bad")).toThrow();
    expect(() => normalizeEvalSample(null)).toThrow();
  });

  it("fills structural defaults on a minimal sample", () => {
    const sample = normalizeEvalSample({ id: 1, epoch: 1, input: "q" });
    expect(sample.target).toBe("");
    expect(sample.messages).toEqual([]);
    expect(sample.events).toEqual([]);
    expect(sample.output).toEqual({ model: "", choices: [], completion: "" });
    expect(sample.scores).toBeNull();
    expect(sample.metadata).toEqual({});
    expect(sample.store).toEqual({});
    expect(sample.model_usage).toEqual({});
    expect(sample.attachments).toEqual({});
  });

  it("fills fallback counts and retry-error tracebacks", () => {
    const sample = normalizeEvalSample({
      id: 1,
      epoch: 1,
      input: "q",
      model_fallbacks: [{ model: "a", fallback_model: "b" }],
      error_retries: [{ message: "boom" }],
    });
    expect(sample.model_fallbacks).toEqual([
      { model: "a", fallback_model: "b", count: 1 },
    ]);
    expect(sample.error_retries).toEqual([
      { message: "boom", traceback: "", traceback_ansi: "" },
    ]);
  });

  it("normalizes retry-error events recursively", () => {
    const sample = normalizeEvalSample({
      id: 1,
      epoch: 1,
      input: "q",
      error_retries: [
        {
          message: "boom",
          traceback: "tb",
          traceback_ansi: "tb",
          events: [{ event: "model", timestamp: "t", model: "m" }],
        },
      ],
    });
    expect(sample.error_retries?.[0]?.events?.[0]).toMatchObject({
      event: "model",
      working_start: 0,
      config: {},
      output: { model: "", choices: [], completion: "" },
    });
  });
});

describe("per-event-type read-time defaults", () => {
  // Each case mirrors a pydantic default (field default / default_factory)
  // that old or crafted logs omit; the base fields are always exercised too.
  const base = { timestamp: "t", working_start: 0 };

  it("error: fills the error payload", () => {
    const event = normalizeEvent({ ...base, event: "error" });
    expect(event).toMatchObject({
      error: { message: "", traceback: "", traceback_ansi: "" },
    });
  });

  it("logger: fills a complete LoggingMessage", () => {
    const event = normalizeEvent({ ...base, event: "logger" });
    expect(event).toMatchObject({
      message: {
        level: "info",
        message: "",
        created: 0,
        filename: "unknown",
        module: "unknown",
        lineno: 0,
      },
    });
  });

  it("score: fills score, history, and intermediate", () => {
    const event = normalizeEvent({ ...base, event: "score" });
    expect(event).toMatchObject({
      score: { value: null, history: [] },
      intermediate: false,
    });
  });

  it("tool: fills call structure and child events", () => {
    const event = normalizeEvent({ ...base, event: "tool" });
    expect(event).toMatchObject({
      id: "",
      function: "",
      arguments: {},
      result: "",
      events: [],
      type: "function",
    });
  });

  it("subtask: fills name, input, result, and child events", () => {
    const event = normalizeEvent({ ...base, event: "subtask" });
    expect(event).toMatchObject({
      name: "",
      input: {},
      result: null,
      events: [],
    });
  });

  it("input: fills input and input_ansi", () => {
    const event = normalizeEvent({ ...base, event: "input" });
    expect(event).toMatchObject({ input: "", input_ansi: "" });
  });

  it("sample_init: fills sample and state", () => {
    const event = normalizeEvent({ ...base, event: "sample_init" });
    expect(event).toMatchObject({ sample: {}, state: null });
  });

  it("info: fills data; compaction: fills type", () => {
    expect(normalizeEvent({ ...base, event: "info" })).toMatchObject({
      data: null,
    });
    expect(normalizeEvent({ ...base, event: "compaction" })).toMatchObject({
      type: "summary",
    });
  });

  it("span_begin / span_end: fill ids and names", () => {
    expect(normalizeEvent({ ...base, event: "span_begin" })).toMatchObject({
      id: "",
      name: "",
    });
    expect(normalizeEvent({ ...base, event: "span_end" })).toMatchObject({
      id: "",
    });
  });

  it("model: fills tool_choice, treating explicit null like absence", () => {
    expect(
      normalizeEvent({ ...base, event: "model", model: "m" })
    ).toMatchObject({ tool_choice: "none" });
    // tool_choice's type doesn't admit null, so a wire null must fill too —
    // toolChoiceEqual reads `.name` on non-string values unguarded.
    expect(
      normalizeEvent({ ...base, event: "model", model: "m", tool_choice: null })
    ).toMatchObject({ tool_choice: "none" });
    expect(
      normalizeEvent({ ...base, event: "tool", result: null, type: null })
    ).toMatchObject({ result: "", type: "function" });
  });

  it("tool/subtask: normalizes nested events recursively", () => {
    const legacyNested = { event: "model", timestamp: "t", model: "m" };
    const tool = normalizeEvent({
      ...base,
      event: "tool",
      id: "call1",
      function: "agent",
      arguments: {},
      result: "",
      events: [legacyNested],
    });
    expect(tool).toMatchObject({
      events: [
        {
          event: "model",
          working_start: 0,
          config: {},
          output: { model: "", choices: [], completion: "" },
        },
      ],
    });

    const subtask = normalizeEvent({
      ...base,
      event: "subtask",
      name: "calc",
      input: {},
      result: null,
      events: [legacyNested],
    });
    expect(subtask).toMatchObject({
      events: [{ event: "model", working_start: 0, config: {} }],
    });
  });

  it("tool: preserves identity when nested events are already clean", () => {
    const clean = {
      ...base,
      event: "tool",
      id: "call1",
      function: "bash",
      arguments: {},
      result: "",
      type: "function",
      events: [{ ...base, event: "state", changes: [] }],
    };
    expect(normalizeEvent(clean)).toBe(clean);
  });

  it("normalizeEvents preserves array identity when every event is clean", () => {
    const events = [
      { event: "step", action: "begin", name: "solve", ...base },
      { event: "step", action: "end", name: "solve", ...base },
    ];
    expect(normalizeEvents(events)).toBe(events);
  });
});

describe("normalizeEvalSpec remaining defaults", () => {
  it("backfills solver_args_passed from solver_args", () => {
    const spec = normalizeEvalSpec({ task: "t", solver_args: { turns: 3 } });
    expect(spec.solver_args_passed).toEqual({ turns: 3 });
  });

  it("nulls solver_args_passed when solver_args is absent", () => {
    const spec = normalizeEvalSpec({ task: "t" });
    expect(spec.solver_args_passed).toBeNull();
    expect(spec.task_version).toBe(0);
  });
});

describe("normalizeEvalPlan on garbage input", () => {
  it("produces a complete default plan", () => {
    expect(normalizeEvalPlan(undefined)).toEqual({
      name: "plan",
      steps: [],
      config: {},
    });
    expect(normalizeEvalPlan("bad")).toEqual({
      name: "plan",
      steps: [],
      config: {},
    });
  });
});
