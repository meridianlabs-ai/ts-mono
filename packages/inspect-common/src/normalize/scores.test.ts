import { describe, expect, it } from "vitest";

import { testScore } from "../testing";

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
      unscored: testScore({ value: NaN }),
    };
    const normalized = normalize({ id: "sample", epoch: 1, scores });

    expect(normalized?.scores).toBe(scores);
    expect(normalized?.scores?.["dictionary"]?.value).toEqual({
      accuracy: null,
    });
    expect(normalized?.scores?.["unscored"]?.value).toBeNaN();
  });

  it("keeps the sample when all score entries are unusable", () => {
    const normalized = normalize({
      id: "sample",
      epoch: 1,
      scores: { broken: {} },
    });
    expect(normalized?.id).toBe("sample");
    expect(normalized?.scores).toEqual({});
  });
});
