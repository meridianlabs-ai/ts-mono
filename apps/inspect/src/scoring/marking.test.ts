import { describe, expect, test } from "vitest";

import { EvalResults, EvalScore } from "@tsmono/inspect-common/types";

import { displayScorersFromRunningMetrics } from "../app/log-view/title-view/ResultsPanel";
import { RunningMetric } from "../client/api/types";

import { resolveHeadlineMetric } from "./headline";
import { expandGroupedMetrics, toDisplayScorers } from "./metrics";

const results = (
  scores: EvalScore[],
  headline?: EvalResults["headline"]
): EvalResults => ({
  total_samples: 1,
  completed_samples: 1,
  scores,
  headline,
});

describe("toDisplayScorers headline marking", () => {
  const scores: EvalScore[] = [
    {
      name: "quality",
      scorer: "grader_a",
      params: {},
      metrics: { mean: { name: "mean", value: 0.1, params: {} } },
    },
    {
      name: "quality",
      scorer: "grader_b",
      params: {},
      metrics: { mean: { name: "mean", value: 0.9, params: {} } },
    },
  ];

  test("marks the metric of the score the headline identifies", () => {
    const headline = resolveHeadlineMetric(
      results(scores, {
        scorer: "grader_b",
        score: "quality",
        metric: "mean",
        reducer: null,
      })
    );
    const summaries = toDisplayScorers(scores, headline);
    const marked = summaries.flatMap((s) =>
      s.metrics.filter((m) => m.headline)
    );
    expect(marked).toHaveLength(1);
    expect(marked[0]?.value).toBe(0.9);
  });

  test("marks nothing when there is no headline", () => {
    const summaries = toDisplayScorers(scores);
    expect(
      summaries.flatMap((s) => s.metrics.filter((m) => m.headline))
    ).toEqual([]);
  });

  test("the mark survives grouped-metric expansion", () => {
    // expandGroupedMetrics reorders and splits summaries, which is why the
    // headline is marked rather than re-matched afterwards
    const withGroups: EvalScore[] = [
      {
        name: "s",
        scorer: "s",
        params: {},
        metrics: {
          stderr: { name: "stderr", value: 0.01, params: {} },
          physics: {
            name: "physics",
            value: 0.7,
            params: { group_key: "category", metric: { name: "accuracy" } },
          },
        },
      },
    ];
    const grouped = toDisplayScorers(
      withGroups,
      resolveHeadlineMetric(
        results(withGroups, {
          scorer: "s",
          score: "s",
          metric: "physics",
          reducer: null,
        })
      )
    );
    const expanded = expandGroupedMetrics(grouped);
    expect(expanded.length).toBeGreaterThan(1);
    const marked = expanded.flatMap((s) => s.metrics.filter((m) => m.headline));
    expect(marked).toHaveLength(1);
    expect(marked[0]?.value).toBe(0.7);
  });
});

describe("displayScorersFromRunningMetrics", () => {
  const running = (
    scorer: string,
    scorer_name: string,
    name: string,
    value: number,
    headline?: boolean
  ): RunningMetric => ({ scorer, scorer_name, name, value, headline });

  test("keeps colliding dict-valued scorers apart", () => {
    const summaries = displayScorersFromRunningMetrics([
      running("quality", "grader_a", "mean", 0.1),
      running("quality", "grader_b", "mean", 0.9, true),
    ]);
    expect(summaries).toHaveLength(2);
    const marked = summaries.flatMap((s) =>
      s.metrics.filter((m) => m.headline)
    );
    expect(marked).toHaveLength(1);
    expect(marked[0]?.value).toBe(0.9);
  });

  test("a separator inside a component cannot forge a collision", () => {
    const summaries = displayScorersFromRunningMetrics([
      running("c", "a-b", "mean", 0.1),
      running("b-c", "a", "mean", 0.2),
    ]);
    expect(summaries).toHaveLength(2);
  });
});
