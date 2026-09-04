import { describe, expect, it } from "vitest";

import { inputString, modelFallbackLines, totalModelFallbacks } from "../utils";

import { normalizeSampleSummaries, normalizeSampleSummary } from "./index";

// The shape real vintage summaries.json rows carry (2024-era writers).
const vintageRow = {
  id: "task_1",
  epoch: 1,
  input: "what is 1+1?",
  target: "2",
  scores: { match: { value: "C", answer: "2" } },
};

describe("normalizeSampleSummary", () => {
  it("fills read-time defaults on a vintage row", () => {
    const summary = normalizeSampleSummary(vintageRow)!;
    expect(summary.metadata).toEqual({});
    expect(summary.model_usage).toEqual({});
    expect(summary.role_usage).toEqual({});
    expect(summary.completed).toBe(true);
    expect(summary.scores).toEqual(vintageRow.scores);
    expect(summary.id).toBe("task_1");
  });

  it("fills absent completed as true, diverging from pydantic's false: an absent field means a pre-field-era settled row", () => {
    expect(normalizeSampleSummary(vintageRow)!.completed).toBe(true);
    // An explicit value — what every live path writes — always wins.
    expect(
      normalizeSampleSummary({ ...vintageRow, completed: false })!.completed
    ).toBe(false);
    expect(
      normalizeSampleSummary({ ...vintageRow, completed: true })!.completed
    ).toBe(true);
  });

  it("nulls scores when absent or malformed", () => {
    expect(
      normalizeSampleSummary({ id: "s1", epoch: 1, input: "q", target: "a" })!
        .scores
    ).toBeNull();
    expect(
      normalizeSampleSummary({ ...vintageRow, scores: "bad" })!.scores
    ).toBeNull();
    expect(
      normalizeSampleSummary({ ...vintageRow, scores: null })!.scores
    ).toBeNull();
  });

  it("fills malformed input and target with empty strings", () => {
    const summary = normalizeSampleSummary({ id: 1, epoch: 1 })!;
    expect(summary.input).toBe("");
    expect(summary.target).toBe("");
    const arrays = normalizeSampleSummary({
      id: 1,
      epoch: 1,
      input: [{ role: "user", content: "q" }],
      target: ["a", "b"],
    })!;
    expect(arrays.input).toEqual([{ role: "user", content: "q" }]);
    expect(arrays.target).toEqual(["a", "b"]);
  });

  it("drops non-record score values so score readers stay unguarded", () => {
    const summary = normalizeSampleSummary({
      ...vintageRow,
      scores: { a: null, b: 1, c: "C", match: { value: "C" } },
    })!;
    expect(summary.scores).toEqual({ match: { value: "C" } });
    expect(Object.values(summary.scores!).map((s) => s.value)).toEqual(["C"]);
  });

  it.each([
    ["a null element", [null]],
    ["a number element", [1]],
    ["a bare string element", ["not a message"]],
    ["a message without content", [{ role: "user" }]],
    ["a message with non-text content", [{ role: "user", content: 5 }]],
  ])("drops %s from a message-list input", (_label, malformed) => {
    const summary = normalizeSampleSummary({
      ...vintageRow,
      input: [...malformed, { role: "user", content: "q" }],
    })!;
    expect(summary.input).toEqual([{ role: "user", content: "q" }]);
    expect(inputString(summary.input)).toEqual(["q"]);
  });

  it("drops malformed content items inside an input message", () => {
    const summary = normalizeSampleSummary({
      ...vintageRow,
      input: [
        {
          role: "user",
          content: [null, { text: "untyped" }, { type: "text", text: "hi" }],
        },
      ],
    })!;
    expect(summary.input).toEqual([
      { role: "user", content: [{ type: "text", text: "hi" }] },
    ]);
    expect(inputString(summary.input)).toEqual(["hi"]);
  });

  it("fills model_fallbacks counts while preserving complete entries", () => {
    const summary = normalizeSampleSummary({
      ...vintageRow,
      model_fallbacks: [
        { model: "a", fallback_model: "b" },
        { model: "c", fallback_model: "d", count: 3 },
      ],
    })!;
    expect(summary.model_fallbacks).toEqual([
      { model: "a", fallback_model: "b", count: 1 },
      { model: "c", fallback_model: "d", count: 3 },
    ]);
  });

  it.each([
    ["a null element", [null]],
    ["a number element", [1]],
    ["a string element", ["openai/gpt-4"]],
    ["a record missing model names", [{ count: 2 }]],
  ])(
    "drops %s from model_fallbacks so fallback readers stay unguarded",
    (_label, malformed) => {
      const summary = normalizeSampleSummary({
        ...vintageRow,
        model_fallbacks: [...malformed, { model: "a", fallback_model: "b" }],
      })!;
      expect(summary.model_fallbacks).toEqual([
        { model: "a", fallback_model: "b", count: 1 },
      ]);
      expect(totalModelFallbacks(summary.model_fallbacks)).toBe(1);
      expect(modelFallbackLines(summary.model_fallbacks)).toEqual(["a → b"]);
    }
  );

  it("nulls a non-array model_fallbacks and resets a non-numeric count", () => {
    expect(
      normalizeSampleSummary({ ...vintageRow, model_fallbacks: "bad" })!
        .model_fallbacks
    ).toBeNull();
    const summary = normalizeSampleSummary({
      ...vintageRow,
      model_fallbacks: [{ model: "a", fallback_model: "b", count: "3" }],
    })!;
    expect(totalModelFallbacks(summary.model_fallbacks)).toBe(1);
  });

  it("returns undefined for non-object entries", () => {
    expect(normalizeSampleSummary(null)).toBeUndefined();
    expect(normalizeSampleSummary("garbage")).toBeUndefined();
    expect(normalizeSampleSummary(42)).toBeUndefined();
  });

  it("fills token defaults inside usage entries", () => {
    const summary = normalizeSampleSummary({
      id: "s1",
      epoch: 1,
      input: "q",
      target: "t",
      scores: null,
      model_usage: { "openai/gpt-4": { input_tokens: 10 } },
      role_usage: { grader: "not-a-record" },
    });
    expect(summary?.model_usage).toEqual({
      "openai/gpt-4": { input_tokens: 10, output_tokens: 0, total_tokens: 0 },
    });
    // Non-record entries drop — pydantic would refuse them outright.
    expect(summary?.role_usage).toEqual({});
  });

  it("drops rows missing id or epoch (no pydantic default to fill)", () => {
    expect(normalizeSampleSummary({ epoch: 1, input: "q" })).toBeUndefined();
    expect(normalizeSampleSummary({ id: "s1", input: "q" })).toBeUndefined();
    expect(
      normalizeSampleSummary({ id: "s1", epoch: "1", input: "q" })
    ).toBeUndefined();
  });

  it("preserves identity when nothing needs filling", () => {
    const clean = {
      id: "s1",
      epoch: 1,
      input: "q",
      target: "a",
      scores: null,
      metadata: { difficulty: "hard" },
      completed: true,
      model_usage: {},
      role_usage: {},
      model_fallbacks: [{ model: "a", fallback_model: "b", count: 2 }],
    };
    expect(normalizeSampleSummary(clean)).toBe(clean);
  });

  it("preserves unknown fields alongside fills", () => {
    const summary = normalizeSampleSummary({
      ...vintageRow,
      from_the_future: "kept",
    })!;
    expect(summary).toMatchObject({ from_the_future: "kept" });
  });
});

describe("normalizeSampleSummaries", () => {
  it("returns [] for non-arrays", () => {
    expect(normalizeSampleSummaries(undefined)).toEqual([]);
    expect(normalizeSampleSummaries({ samples: [] })).toEqual([]);
  });

  it("drops non-object entries and normalizes the rest", () => {
    const summaries = normalizeSampleSummaries([null, "bad", vintageRow]);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.completed).toBe(true);
    expect(summaries[0]?.metadata).toEqual({});
  });

  it("preserves array identity when every row is clean", () => {
    const rows = [
      {
        id: 1,
        epoch: 1,
        input: "q",
        target: "a",
        scores: null,
        metadata: {},
        completed: false,
        model_usage: {},
        role_usage: {},
      },
    ];
    expect(normalizeSampleSummaries(rows)).toBe(rows);
  });
});
