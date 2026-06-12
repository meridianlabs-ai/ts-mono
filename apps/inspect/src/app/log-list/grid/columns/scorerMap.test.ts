import { describe, expect, it } from "vitest";

import { LogDetails } from "../../../../client/api/types";

import { computeScorerMap, scorerMapsEqual } from "./scorerMap";

const details = (
  scores: Array<{ name: string; metrics: Record<string, number | string> }>
): LogDetails =>
  ({
    results: {
      scores: scores.map((s) => ({
        name: s.name,
        metrics: Object.fromEntries(
          Object.entries(s.metrics).map(([m, value]) => [m, { value }])
        ),
      })),
    },
  }) as unknown as LogDetails;

describe("computeScorerMap", () => {
  it("collects one entry per (scorer, metric) pair across logs", () => {
    const map = computeScorerMap({
      "/dir/a.eval": details([{ name: "match", metrics: { accuracy: 0.5 } }]),
      "/dir/b.eval": details([
        { name: "model_graded", metrics: { accuracy: 0.7, stderr: 0.1 } },
      ]),
    });
    expect(map).toEqual({
      "match/accuracy": {
        scorerName: "match",
        metricName: "accuracy",
        valueType: "number",
      },
      "model_graded/accuracy": {
        scorerName: "model_graded",
        metricName: "accuracy",
        valueType: "number",
      },
      "model_graded/stderr": {
        scorerName: "model_graded",
        metricName: "stderr",
        valueType: "number",
      },
    });
  });

  it("only includes logs under the scope prefix", () => {
    const map = computeScorerMap(
      {
        "/dir/sub/a.eval": details([
          { name: "match", metrics: { accuracy: 1 } },
        ]),
        "/other/b.eval": details([{ name: "other", metrics: { f1: 1 } }]),
      },
      "/dir/"
    );
    expect(Object.keys(map)).toEqual(["match/accuracy"]);
  });

  it("skips logs without score results", () => {
    const map = computeScorerMap({
      "/dir/a.eval": { sampleSummaries: [] } as unknown as LogDetails,
    });
    expect(map).toEqual({});
  });
});

describe("scorerMapsEqual", () => {
  it("treats content-equal maps with distinct identities as equal", () => {
    const a = computeScorerMap({
      "/dir/a.eval": details([{ name: "match", metrics: { accuracy: 0.5 } }]),
    });
    const b = computeScorerMap({
      "/dir/a.eval": details([{ name: "match", metrics: { accuracy: 0.9 } }]),
    });
    expect(a).not.toBe(b);
    expect(scorerMapsEqual(a, b)).toBe(true);
  });

  it("treats two empty maps as equal", () => {
    expect(scorerMapsEqual({}, {})).toBe(true);
  });

  it("detects an added (scorer, metric) pair", () => {
    const a = computeScorerMap({
      "/dir/a.eval": details([{ name: "match", metrics: { accuracy: 1 } }]),
    });
    const b = computeScorerMap({
      "/dir/a.eval": details([
        { name: "match", metrics: { accuracy: 1, stderr: 0 } },
      ]),
    });
    expect(scorerMapsEqual(a, b)).toBe(false);
    expect(scorerMapsEqual(b, a)).toBe(false);
  });

  it("detects a changed value type for the same pair", () => {
    const a = computeScorerMap({
      "/dir/a.eval": details([{ name: "match", metrics: { grade: 1 } }]),
    });
    const b = computeScorerMap({
      "/dir/a.eval": details([{ name: "match", metrics: { grade: "I" } }]),
    });
    expect(scorerMapsEqual(a, b)).toBe(false);
  });

  it("ignores key insertion order", () => {
    const a = computeScorerMap({
      "/dir/a.eval": details([{ name: "one", metrics: { accuracy: 1 } }]),
      "/dir/b.eval": details([{ name: "two", metrics: { accuracy: 1 } }]),
    });
    const b = computeScorerMap({
      "/dir/b.eval": details([{ name: "two", metrics: { accuracy: 1 } }]),
      "/dir/a.eval": details([{ name: "one", metrics: { accuracy: 1 } }]),
    });
    expect(scorerMapsEqual(a, b)).toBe(true);
  });
});
