import { describe, expect, test } from "vitest";

import {
  EvalMetric,
  EvalResults,
  EvalScore,
} from "@tsmono/inspect-common/types";

import { headlineMetric, leadWith } from "./headline";

const metric = (name: string, value: number): EvalMetric => ({
  name,
  value,
  params: {},
});

const score = (
  name: string,
  metrics: Record<string, number>,
  reducer?: string | null
): EvalScore => ({
  name,
  scorer: name,
  reducer,
  params: {},
  metrics: Object.fromEntries(
    Object.entries(metrics).map(([k, v]) => [k, metric(k, v)])
  ),
});

const results = (
  scores: EvalScore[],
  headline?: EvalResults["headline"]
): EvalResults => ({
  total_samples: 1,
  completed_samples: 1,
  scores,
  headline,
});

describe("headlineMetric", () => {
  test("uses the headline resolved at scoring time", () => {
    const evalResults = results(
      [score("includes", { stderr: 0.1, accuracy: 0.9 })],
      {
        scorer: "includes",
        score: "includes",
        metric: "accuracy",
        reducer: null,
      }
    );
    expect(headlineMetric(evalResults)?.name).toBe("accuracy");
  });

  test("distinguishes same-named scores by reducer", () => {
    const evalResults = results(
      [
        score("includes", { accuracy: 0.4 }, "mean"),
        score("includes", { accuracy: 0.8 }, "max"),
      ],
      {
        scorer: "includes",
        score: "includes",
        metric: "accuracy",
        reducer: "max",
      }
    );
    expect(headlineMetric(evalResults)?.value).toBe(0.8);
  });

  test("falls back to the first metric of the first score", () => {
    // logs written before headline metrics existed carry no `headline`
    const evalResults = results([
      score("includes", { stderr: 0.1, accuracy: 0.9 }),
    ]);
    expect(headlineMetric(evalResults)?.name).toBe("stderr");
  });

  test("falls back when the headline no longer matches the scores", () => {
    const evalResults = results([score("includes", { stderr: 0.1 })], {
      scorer: "gone",
      score: "gone",
      metric: "accuracy",
      reducer: null,
    });
    expect(headlineMetric(evalResults)?.name).toBe("stderr");
  });

  test("distinguishes dict-valued scorers that share a score name", () => {
    const shared = (scorer: string, value: number): EvalScore => ({
      name: "quality",
      scorer,
      params: {},
      metrics: { mean: metric("mean", value) },
    });
    const evalResults = results(
      [shared("grader_a", 0.1), shared("grader_b", 0.9)],
      {
        scorer: "grader_b",
        score: "quality",
        metric: "mean",
        reducer: null,
      }
    );
    expect(headlineMetric(evalResults)?.value).toBe(0.9);
  });

  test("picks the score carrying the metric when identities are identical", () => {
    // `metrics=[mean(), {"quality": [accuracy()]}]` on a scorer named `quality`
    // emits two rows indistinguishable by scorer/score/reducer, each holding a
    // different metric
    const evalResults = results(
      [score("quality", { mean: 0.2 }), score("quality", { accuracy: 0.8 })],
      {
        scorer: "quality",
        score: "quality",
        metric: "accuracy",
        reducer: null,
      }
    );
    expect(headlineMetric(evalResults)?.value).toBe(0.8);
  });

  test('treats "" as a real metric key', () => {
    const evalResults = results([score("includes", { "": 0.5 })]);
    expect(headlineMetric(evalResults)?.value).toBe(0.5);
  });

  test("resolves the task declaration when nothing was stamped", () => {
    // hand-authored / externally produced logs carry `eval.headline_metric`
    // without the `results.headline` that scoring would have resolved
    const evalResults = results([score("includes", { stderr: 0.1 })]);
    expect(headlineMetric(evalResults, { metric: "stderr" })?.value).toBe(0.1);
  });

  test("an unset declaration field matches any score", () => {
    // `HeadlineMetric(metric="accuracy")` skips scores that don't report one,
    // whatever their scorer — matching the Python resolver
    const evalResults = results([
      score("sanity", { coverage: 0.1 }),
      score("main", { accuracy: 0.9 }),
    ]);
    expect(headlineMetric(evalResults, { metric: "accuracy" })?.value).toBe(
      0.9
    );
  });

  test("a stamped headline wins over the declaration", () => {
    const evalResults = results(
      [score("sanity", { coverage: 0.1 }), score("main", { accuracy: 0.9 })],
      { scorer: "sanity", score: "sanity", metric: "coverage", reducer: null }
    );
    expect(headlineMetric(evalResults, { metric: "accuracy" })?.value).toBe(
      0.1
    );
  });

  test("falls back to convention when the declaration matches nothing", () => {
    const evalResults = results([score("includes", { stderr: 0.1 })]);
    expect(headlineMetric(evalResults, { scorer: "gone" })?.name).toBe(
      "stderr"
    );
  });

  test("returns undefined when there is nothing to report", () => {
    expect(headlineMetric(undefined)).toBeUndefined();
    expect(headlineMetric(results([]))).toBeUndefined();
    expect(headlineMetric(results([score("includes", {})]))).toBeUndefined();
  });
});

describe("leadWith", () => {
  test("moves the index to the front and keeps the rest in order", () => {
    expect(leadWith(["a", "b", "c"], 2)).toEqual(["c", "a", "b"]);
  });

  test("is a no-op for index 0 and -1", () => {
    expect(leadWith(["a", "b"], 0)).toEqual(["a", "b"]);
    expect(leadWith(["a", "b"], -1)).toEqual(["a", "b"]);
  });
});
