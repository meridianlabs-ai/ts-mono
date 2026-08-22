import { describe, expect, it } from "vitest";

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

  it("returns undefined for non-object entries", () => {
    expect(normalizeSampleSummary(null)).toBeUndefined();
    expect(normalizeSampleSummary("garbage")).toBeUndefined();
    expect(normalizeSampleSummary(42)).toBeUndefined();
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
