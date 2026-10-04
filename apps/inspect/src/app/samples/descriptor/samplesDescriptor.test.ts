import { describe, expect, it } from "vitest";

import { normalizeSampleSummary } from "@tsmono/inspect-common/normalize";
import { testScore } from "@tsmono/inspect-common/testing";

import { testSampleSummary } from "../../../client/api/testClientApi";
import { SampleSummary } from "../../../client/api/types";
import { kScoreTypeNumeric } from "../../../constants";
import { ScoreLabel } from "../../types";

import { createEvalDescriptor } from "./samplesDescriptor";

const dictLabel: ScoreLabel = { scorer: "s", name: "k" };
const otherLabel: ScoreLabel = { scorer: "other", name: "other" };

const sampleWithRawScore = (entry: unknown): SampleSummary => {
  const sample = normalizeSampleSummary({
    ...testSampleSummary(),
    scores: { s: entry, other: testScore({ value: 9 }) },
  });
  if (!sample) throw new Error("Expected a sample summary");
  return sample;
};

describe("dictionary score values", () => {
  it.each([0, false, "", "C"])(
    "preserves standalone score value %s",
    (value) => {
      const label: ScoreLabel = { scorer: "s", name: "s" };
      const sample = sampleWithRawScore(testScore({ value }));
      const descriptor = createEvalDescriptor([label], [sample]);

      expect(descriptor?.score(sample, label)?.value).toBe(value);
    }
  );

  it.each([
    { name: "null", entry: { value: null } },
    { name: "missing", entry: {} },
  ])("ignores a $name whole value without losing other scores", ({ entry }) => {
    const valid = sampleWithRawScore(testScore({ value: { k: 1 } }));
    const invalid = sampleWithRawScore(entry);
    const descriptor = createEvalDescriptor(
      [dictLabel, otherLabel],
      [valid, invalid]
    );

    expect(descriptor?.score(valid, dictLabel)?.value).toBe(1);
    expect(descriptor?.score(invalid, dictLabel)?.value).toBeUndefined();
    expect(descriptor?.score(invalid, dictLabel)?.render()).toBe("");
    expect(descriptor?.scorerDescriptor(invalid, dictLabel).scores()).toEqual(
      []
    );
    expect(descriptor?.score(invalid, otherLabel)?.value).toBe(9);
    expect(invalid.scores?.["s"]).toBeUndefined();
  });

  it("preserves a legitimate null dictionary entry", () => {
    const sample = sampleWithRawScore(testScore({ value: { k: null } }));
    const descriptor = createEvalDescriptor([dictLabel], [sample]);

    expect(descriptor?.score(sample, dictLabel)?.value).toBeNull();
    expect(descriptor?.score(sample, dictLabel)?.render()).toBe("null");
    expect(sample.scores?.["s"]?.value).toEqual({ k: null });
  });

  it("ignores a scorer absent from a sample", () => {
    const valid = sampleWithRawScore(testScore({ value: { k: 1 } }));
    const absent = testSampleSummary({
      scores: { other: testScore({ value: 9 }) },
    });
    const descriptor = createEvalDescriptor(
      [dictLabel, otherLabel],
      [valid, absent]
    );

    expect(descriptor?.scorerDescriptor(absent, dictLabel).scores()).toEqual(
      []
    );
    expect(descriptor?.score(absent, dictLabel)?.render()).toBe("");
    expect(descriptor?.score(absent, otherLabel)?.value).toBe(9);
  });

  it("keeps unscored samples out of dictionary column type detection", () => {
    const valid = sampleWithRawScore(testScore({ value: { k: 1 } }));
    const unscored = sampleWithRawScore(testScore({ value: NaN }));
    const descriptor = createEvalDescriptor([dictLabel], [valid, unscored]);

    expect(descriptor?.scoreDescriptor(dictLabel)?.scoreType).toBe(
      kScoreTypeNumeric
    );
    expect(descriptor?.score(unscored, dictLabel)?.render()).toBe("");
    expect(unscored.scores?.["s"]?.value).toBeNaN();
  });

  it("does not treat list indexes as dictionary score names", () => {
    const label: ScoreLabel = { scorer: "s", name: "0" };
    const valid = sampleWithRawScore(testScore({ value: { "0": 1 } }));
    const list = sampleWithRawScore(testScore({ value: [99] }));
    const descriptor = createEvalDescriptor([label], [valid, list]);

    expect(descriptor?.scoreDescriptor(label)?.max).toBe(1);
    expect(descriptor?.score(list, label)?.render()).toBe("");
  });
});
