import { describe, expect, it } from "vitest";

import { testScore, testScoreEdit } from "../testing";

import { normalizeEvalSample, normalizeSampleSummary } from "./index";

describe.each([
  { name: "sample summaries", normalize: normalizeSampleSummary },
  { name: "full samples", normalize: normalizeEvalSample },
])("score normalization in $name", ({ normalize }) => {
  it.each([
    { name: "null value", entry: { value: null } },
    { name: "missing value", entry: {} },
    { name: "undefined value", entry: { value: undefined } },
    { name: "null entry", entry: null },
    { name: "scalar entry", entry: 42 },
  ])(
    "drops a $name while preserving other scores and the input",
    ({ entry }) => {
      const valid = testScore({ value: { accuracy: 1 } });
      const raw = { id: "sample", epoch: 1, scores: { invalid: entry, valid } };
      const normalized = normalize(raw);

      expect(normalized?.id).toBe("sample");
      expect(normalized?.scores).toEqual({ valid });
      expect(normalized?.scores?.["valid"]).toBe(valid);
      expect(raw.scores.invalid).toBe(entry);
    }
  );

  it("preserves valid values, null dictionary leaves, and NaNs without copying", () => {
    const scores = {
      zero: testScore({ value: 0 }),
      false: testScore({ value: false }),
      empty: testScore({ value: "" }),
      list: testScore({ value: [1, 2] }),
      dictionary: testScore({ value: { accuracy: null } }),
      unscored: testScore({
        value: NaN,
        reason: "refusal",
        explanation: "The model declined to answer.",
        answer: "I cannot answer that.",
      }),
    };
    const normalized = normalize({ id: "sample", epoch: 1, scores });

    expect(normalized?.scores).toBe(scores);
    expect(normalized?.scores?.["dictionary"]?.value).toEqual({
      accuracy: null,
    });
    expect(normalized?.scores?.["unscored"]?.value).toBeNaN();
    expect(normalized?.scores?.["unscored"]).toBe(scores.unscored);
  });

  it.each([null, undefined])(
    "omits the whole unusable score with value %s, including its context",
    (value) => {
      const entry = {
        ...testScore({
          answer: "answer",
          explanation: "explanation",
          reason: "refusal",
          metadata: { source: "grader" },
          history: [testScoreEdit({ value: 1 })],
        }),
        value,
      };
      const raw = { id: "sample", epoch: 1, scores: { unusable: entry } };
      const original = structuredClone(raw);

      expect(normalize(raw)?.scores).toEqual({});
      expect(raw).toEqual(original);
    }
  );

  it("keeps the sample when all score entries are unusable", () => {
    const normalized = normalize({
      id: "sample",
      epoch: 1,
      scores: { broken: {} },
    });
    expect(normalized?.id).toBe("sample");
    expect(normalized?.scores).toEqual({});
  });

  it.each([
    { name: "numeric answer", fields: { answer: 5 } },
    { name: "object answer", fields: { answer: { a: 1 } } },
    { name: "array explanation", fields: { explanation: ["x"] } },
    { name: "object reason", fields: { reason: { code: 1 } } },
    { name: "string metadata", fields: { metadata: "grader" } },
  ])("clears a $name to null while keeping the score value", ({ fields }) => {
    const valid = testScore({ value: 1, answer: "A" });
    const raw = {
      id: "sample",
      epoch: 1,
      scores: { malformed: { ...testScore({ value: 0.5 }), ...fields }, valid },
    };
    const original = structuredClone(raw);
    const scores = normalize(raw)?.scores;

    const [field] = Object.keys(fields);
    expect(scores?.["malformed"]?.value).toBe(0.5);
    expect(scores?.["malformed"]).toHaveProperty(field!, null);
    expect(scores?.["valid"]).toBe(valid);
    expect(raw).toEqual(original);
  });
});
