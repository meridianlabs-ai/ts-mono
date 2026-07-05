import { describe, expect, it } from "vitest";

import { LogHandle } from "@tsmono/inspect-common/types";

import { EvalLogStatus } from "../@types/extraInspect";

import { computeLogsWithRetried } from "./logListing";

const log = (
  overrides: Partial<LogHandle> & Pick<LogHandle, "name">
): LogHandle => ({
  task: null,
  task_id: null,
  mtime: null,
  ...overrides,
});

const preview = (status: EvalLogStatus) => ({ status });

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

