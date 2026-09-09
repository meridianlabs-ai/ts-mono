import { describe, expect, test } from "vitest";

import { groupMetricRuns, isGroupRun, leadWithMetricColumn } from "./scores";
import { MetricSummary } from "./types";

const m = (name: string, group?: string | null): MetricSummary => ({
  name,
  group,
  value: 0,
});

describe("groupMetricRuns", () => {
  test("single run when all share a group", () => {
    const runs = groupMetricRuns([
      m("yes", "frequency"),
      m("no", "frequency"),
      m("unsure", "frequency"),
    ]);
    expect(runs).toHaveLength(1);
    const run = runs[0];
    if (run === undefined) throw new Error("expected a run");
    expect(run.group).toBe("frequency");
    expect(run.metrics.map((x) => x.name)).toEqual(["yes", "no", "unsure"]);
  });

  test("splits on group boundary", () => {
    const runs = groupMetricRuns([
      m("mean"),
      m("yes", "frequency"),
      m("no", "frequency"),
      m("stderr"),
    ]);
    expect(runs.map((r) => r.group ?? null)).toEqual([null, "frequency", null]);
    const frequencyRun = runs[1];
    if (frequencyRun === undefined) throw new Error("expected a run");
    expect(frequencyRun.metrics).toHaveLength(2);
  });

  test("treats undefined and null group as same run", () => {
    const runs = groupMetricRuns([m("a", null), m("b", undefined)]);
    expect(runs).toHaveLength(1);
  });

  test("empty input", () => {
    expect(groupMetricRuns([])).toEqual([]);
  });
});

describe("isGroupRun", () => {
  test("true when ≥2 metrics share a non-null group", () => {
    expect(
      isGroupRun({
        group: "frequency",
        metrics: [m("yes", "frequency"), m("no", "frequency")],
      })
    ).toBe(true);
  });

  test("false when group is null", () => {
    expect(isGroupRun({ group: null, metrics: [m("mean"), m("stderr")] })).toBe(
      false
    );
  });

  test("false when run has only one member", () => {
    expect(
      isGroupRun({ group: "frequency", metrics: [m("yes", "frequency")] })
    ).toBe(false);
  });
});

describe("leadWithMetricColumn", () => {
  const metrics = [
    m("mean"),
    m("stderr"),
    m("yes", "frequency"),
    m("no", "frequency"),
    m("var"),
  ];

  test("no-op when the headline is absent or already first", () => {
    expect(leadWithMetricColumn(metrics, -1)).toEqual(metrics);
    expect(leadWithMetricColumn(metrics, 0)).toEqual(metrics);
    expect(leadWithMetricColumn(metrics, 99)).toEqual(metrics);
  });

  test("an ungrouped headline moves alone", () => {
    expect(leadWithMetricColumn(metrics, 4).map((x) => x.name)).toEqual([
      "var",
      "mean",
      "stderr",
      "yes",
      "no",
    ]);
  });

  test("a grouped headline brings its whole run, leading it", () => {
    expect(leadWithMetricColumn(metrics, 3).map((x) => x.name)).toEqual([
      "no",
      "yes",
      "mean",
      "stderr",
      "var",
    ]);
  });

  test("adjacent runs of a different group stay behind", () => {
    const twoRuns = [
      m("a", "first"),
      m("b", "first"),
      m("c", "second"),
      m("d", "second"),
    ];
    expect(leadWithMetricColumn(twoRuns, 3).map((x) => x.name)).toEqual([
      "d",
      "c",
      "a",
      "b",
    ]);
  });
});
