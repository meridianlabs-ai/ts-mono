import { describe, expect, test } from "vitest";

import { groupMetricRuns, isGroupRun } from "./scores";
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
    expect(runs[0].group).toBe("frequency");
    expect(runs[0].metrics.map((x) => x.name)).toEqual(["yes", "no", "unsure"]);
  });

  test("splits on group boundary", () => {
    const runs = groupMetricRuns([
      m("mean"),
      m("yes", "frequency"),
      m("no", "frequency"),
      m("stderr"),
    ]);
    expect(runs.map((r) => r.group ?? null)).toEqual([null, "frequency", null]);
    expect(runs[1].metrics).toHaveLength(2);
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
