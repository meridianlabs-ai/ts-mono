import { describe, expect, it } from "vitest";

import { LogHandle } from "@tsmono/inspect-common/types";

import { EvalLogStatus } from "../@types/extraInspect";
import { ScoreView } from "../app/samples/header-v2/ViewToggle";
import { SampleSummary } from "../client/api/types";

import {
  compareSamples,
  computeLogsWithRetried,
  readEvalScorePanelView,
  resolveScorePanelSort,
  resolveScorePanelView,
  samplesAreSorted,
  ScorePanelSortState,
} from "./hooks";

const log = (
  overrides: Partial<LogHandle> & Pick<LogHandle, "name">
): LogHandle => ({
  task: null,
  task_id: null,
  mtime: null,
  ...overrides,
});

const preview = (status: EvalLogStatus) => ({ status });

const s = (id: string | number, epoch: number): SampleSummary => ({
  id,
  epoch,
  input: "",
  target: "",
  scores: null,
});

describe("compareSamples / samplesAreSorted", () => {
  it("orders numeric ids ascending then epoch ascending", () => {
    expect(compareSamples(s(1, 0), s(2, 0))).toBeLessThan(0);
    expect(compareSamples(s(2, 0), s(1, 0))).toBeGreaterThan(0);
    expect(compareSamples(s(1, 0), s(1, 1))).toBeLessThan(0);
    expect(compareSamples(s(1, 1), s(1, 1))).toBe(0);
  });

  it("orders string ids lexicographically", () => {
    expect(compareSamples(s("a", 0), s("b", 0))).toBeLessThan(0);
  });

  it("detects sorted vs unsorted arrays", () => {
    expect(samplesAreSorted([s(1, 0), s(1, 1), s(2, 0)])).toBe(true);
    expect(samplesAreSorted([s(2, 0), s(1, 0)])).toBe(false);
    expect(samplesAreSorted([s(1, 0)])).toBe(true);
    expect(samplesAreSorted([])).toBe(true);
  });
});

describe("computeLogsWithRetried", () => {
  it("marks a lone log as not retried", () => {
    const only = log({ name: "/a/flow/2026_task_abc.eval", task_id: "abc" });
    const logs = [only];
    const result = computeLogsWithRetried(logs, {
      [only.name]: preview("success"),
    });
    expect(result).toEqual([{ ...only, retried: false }]);
  });

  it("does not flag logs with distinct task_ids in the same folder", () => {
    const one = log({ name: "/a/flow/2026_one_abc.eval", task_id: "abc" });
    const two = log({ name: "/a/flow/2026_two_def.eval", task_id: "def" });
    const logs = [one, two];
    const result = computeLogsWithRetried(logs, {
      [one.name]: preview("success"),
      [two.name]: preview("success"),
    });
    expect(result.map((r) => r.retried)).toEqual([false, false]);
  });

  it("flags older duplicate in the same folder as retried (same status)", () => {
    const older = log({
      name: "/a/flow/2026_task_abc.eval",
      task_id: "abc",
      mtime: 100,
    });
    const newer = log({
      name: "/a/flow/2027_task_abc.eval",
      task_id: "abc",
      mtime: 200,
    });
    const result = computeLogsWithRetried([older, newer], {
      [older.name]: preview("success"),
      [newer.name]: preview("success"),
    });
    expect(result.find((r) => r.name === older.name)?.retried).toBe(true);
    expect(result.find((r) => r.name === newer.name)?.retried).toBe(false);
  });

  it("prefers newer success over older orphaned started", () => {
    const olderStarted = log({
      name: "/a/flow/2026_task_abc.eval",
      task_id: "abc",
      mtime: 100,
    });
    const newerSuccess = log({
      name: "/a/flow/2027_task_abc.eval",
      task_id: "abc",
      mtime: 200,
    });
    const result = computeLogsWithRetried([olderStarted, newerSuccess], {
      [olderStarted.name]: preview("started"),
      [newerSuccess.name]: preview("success"),
    });
    expect(result.find((r) => r.name === olderStarted.name)?.retried).toBe(
      true
    );
    expect(result.find((r) => r.name === newerSuccess.name)?.retried).toBe(
      false
    );
  });

  it("keeps started as active when it is the newest in the group", () => {
    const olderSuccess = log({
      name: "/a/flow/2026_task_abc.eval",
      task_id: "abc",
      mtime: 100,
    });
    const newerStarted = log({
      name: "/a/flow/2027_task_abc.eval",
      task_id: "abc",
      mtime: 200,
    });
    const result = computeLogsWithRetried([olderSuccess, newerStarted], {
      [olderSuccess.name]: preview("success"),
      [newerStarted.name]: preview("started"),
    });
    expect(result.find((r) => r.name === olderSuccess.name)?.retried).toBe(
      true
    );
    expect(result.find((r) => r.name === newerStarted.name)?.retried).toBe(
      false
    );
  });

  it("picks newest success when an orphaned started sits between failed retries", () => {
    const oldError = log({
      name: "/a/flow/2026-05-08T08-08-34_task_abc.eval",
      task_id: "abc",
      mtime: 100,
    });
    const orphanedStarted = log({
      name: "/a/flow/2026-05-08T09-00-00_task_abc.eval",
      task_id: "abc",
      mtime: 200,
    });
    const midError = log({
      name: "/a/flow/2026-05-08T09-49-08_task_abc.eval",
      task_id: "abc",
      mtime: 300,
    });
    const newestSuccess = log({
      name: "/a/flow/2026-05-08T10-56-02_task_abc.eval",
      task_id: "abc",
      mtime: 400,
    });
    const result = computeLogsWithRetried(
      [oldError, orphanedStarted, midError, newestSuccess],
      {
        [oldError.name]: preview("error"),
        [orphanedStarted.name]: preview("started"),
        [midError.name]: preview("error"),
        [newestSuccess.name]: preview("success"),
      }
    );
    expect(result.find((r) => r.name === newestSuccess.name)?.retried).toBe(
      false
    );
    expect(result.find((r) => r.name === orphanedStarted.name)?.retried).toBe(
      true
    );
    expect(result.find((r) => r.name === oldError.name)?.retried).toBe(true);
    expect(result.find((r) => r.name === midError.name)?.retried).toBe(true);
  });

  it("prefers success over error regardless of mtime", () => {
    const olderSuccess = log({
      name: "/a/flow/2026_task_abc.eval",
      task_id: "abc",
      mtime: 100,
    });
    const newerError = log({
      name: "/a/flow/2027_task_abc.eval",
      task_id: "abc",
      mtime: 200,
    });
    const result = computeLogsWithRetried([olderSuccess, newerError], {
      [olderSuccess.name]: preview("success"),
      [newerError.name]: preview("error"),
    });
    expect(result.find((r) => r.name === olderSuccess.name)?.retried).toBe(
      false
    );
    expect(result.find((r) => r.name === newerError.name)?.retried).toBe(true);
  });

  // Regression: logs with the same task_id but in DIFFERENT folders must not
  // collide. This happens when the view is opened on a parent directory that
  // contains multiple copies of an eval-set, each in its own subfolder.
  it("does not dedupe across different parent folders", () => {
    const flowA = log({ name: "/a/flow_a/2026_task_abc.eval", task_id: "abc" });
    const flowB = log({ name: "/a/flow_b/2026_task_abc.eval", task_id: "abc" });
    const logs = [flowA, flowB];
    const result = computeLogsWithRetried(logs, {
      [flowA.name]: preview("success"),
      [flowB.name]: preview("success"),
    });
    expect(result.map((r) => r.retried)).toEqual([false, false]);
  });

  it("dedupes independently within each folder", () => {
    const a1 = log({
      name: "/a/flow_a/2026_task_abc.eval",
      task_id: "abc",
      mtime: 100,
    });
    const a2 = log({
      name: "/a/flow_a/2027_task_abc.eval",
      task_id: "abc",
      mtime: 200,
    });
    const b1 = log({
      name: "/a/flow_b/2026_task_abc.eval",
      task_id: "abc",
      mtime: 300,
    });
    const result = computeLogsWithRetried([a1, a2, b1], {
      [a1.name]: preview("success"),
      [a2.name]: preview("success"),
      [b1.name]: preview("success"),
    });
    expect(result.find((r) => r.name === a1.name)?.retried).toBe(true);
    expect(result.find((r) => r.name === a2.name)?.retried).toBe(false);
    expect(result.find((r) => r.name === b1.name)?.retried).toBe(false);
  });

  it("leaves logs without task_id untouched (retried: undefined)", () => {
    const legacy = log({ name: "/a/flow/legacy.eval" });
    const logs = [legacy];
    const result = computeLogsWithRetried(logs, {
      [legacy.name]: preview("success"),
    });
    const first = result[0];
    if (first === undefined) throw new Error("expected a result");
    expect(first.retried).toBeUndefined();
  });

  it("preserves input order", () => {
    const logs = [
      log({ name: "/a/flow/z.eval", task_id: "a" }),
      log({ name: "/a/flow/y.eval", task_id: "b" }),
      log({ name: "/a/flow/x.eval", task_id: "c" }),
    ];
    const result = computeLogsWithRetried(logs, {});
    expect(result.map((r) => r.name)).toEqual(logs.map((l) => l.name));
  });
});

// =============================================================================
// resolveScorePanelView
//
// Priority: user override (stored) > eval default > built-in count rule.
// =============================================================================

describe("resolveScorePanelView", () => {
  it("prefers stored over everything", () => {
    expect(resolveScorePanelView("grid", "chips", 2)).toBe("grid");
    expect(resolveScorePanelView("chips", "grid", 100)).toBe("chips");
  });

  it("falls back to eval default when no user override", () => {
    expect(resolveScorePanelView(undefined, "grid", 2)).toBe("grid");
    expect(resolveScorePanelView(undefined, "chips", 100)).toBe("chips");
  });

  it("falls back to count-based default when neither is set", () => {
    expect(resolveScorePanelView(undefined, undefined, 1)).toBe("chips");
    expect(resolveScorePanelView(undefined, undefined, 6)).toBe("chips");
    expect(resolveScorePanelView(undefined, undefined, 7)).toBe("grid");
    expect(resolveScorePanelView(undefined, undefined, 50)).toBe("grid");
  });

  it("treats undefined as 'unset' for stored, including empty count", () => {
    // Sanity: 0 scores still resolves to chips via the count rule.
    expect(resolveScorePanelView(undefined, undefined, 0)).toBe("chips");
  });

  it("works with all four combinations of (stored, evalDefault)", () => {
    const cases: Array<
      [ScoreView | undefined, ScoreView | undefined, number, ScoreView]
    > = [
      ["grid", "chips", 4, "grid"], // stored wins
      [undefined, "grid", 4, "grid"], // eval default wins
      ["chips", undefined, 100, "chips"], // stored wins, no eval default
      [undefined, undefined, 100, "grid"], // count rule
    ];
    for (const [stored, evalDefault, count, expected] of cases) {
      expect(resolveScorePanelView(stored, evalDefault, count)).toBe(expected);
    }
  });
});

// =============================================================================
// readEvalScorePanelView
//
// The eval-author default field was renamed `view` → `default`; old logs
// carry `view`, new logs carry `default`, and either must resolve.
// =============================================================================

describe("readEvalScorePanelView", () => {
  it("reads the new `default` field", () => {
    expect(readEvalScorePanelView({ default: "grid" })).toBe("grid");
  });

  it("reads the legacy `view` field from old logs", () => {
    expect(readEvalScorePanelView({ view: "chips" })).toBe("chips");
  });

  it("prefers `default` when both are present", () => {
    expect(readEvalScorePanelView({ default: "grid", view: "chips" })).toBe(
      "grid"
    );
  });

  it("returns undefined when unset, null, or empty", () => {
    expect(readEvalScorePanelView(undefined)).toBeUndefined();
    expect(readEvalScorePanelView(null)).toBeUndefined();
    expect(readEvalScorePanelView({})).toBeUndefined();
    expect(
      readEvalScorePanelView({ default: null, view: null })
    ).toBeUndefined();
  });
});

// =============================================================================
// resolveScorePanelSort
//
// Priority: user override (stored) > eval default > unsorted.
// =============================================================================

describe("resolveScorePanelSort", () => {
  const stored: ScorePanelSortState = { column: "value", dir: "desc" };
  const evalDefault: ScorePanelSortState = { column: "name", dir: "asc" };

  it("prefers stored over eval default", () => {
    expect(resolveScorePanelSort(stored, evalDefault)).toEqual(stored);
  });

  it("falls back to eval default when no user override", () => {
    expect(resolveScorePanelSort(undefined, evalDefault)).toEqual(evalDefault);
  });

  it("falls back to unsorted when neither is set", () => {
    expect(resolveScorePanelSort(undefined, undefined)).toEqual({
      column: null,
      dir: "asc",
    });
  });

  it("respects an explicit unsorted user override (column: null) over eval default", () => {
    // The user explicitly chose "Default" sort — that should beat the
    // eval-supplied default, not be confused with "user has no preference".
    const userUnsorted: ScorePanelSortState = { column: null, dir: "asc" };
    expect(resolveScorePanelSort(userUnsorted, evalDefault)).toEqual(
      userUnsorted
    );
  });
});
