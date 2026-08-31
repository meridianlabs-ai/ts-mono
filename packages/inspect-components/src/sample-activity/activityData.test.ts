import { describe, expect, it } from "vitest";

import {
  testApprovalEvent,
  testCompactionEvent,
  testErrorEvent,
  testInputEvent,
  testInterruptEvent,
  testModelEvent,
  testModelOutput,
  testModelUsage,
  testSampleLimitEvent,
  testScoreEvent,
  testToolEvent,
} from "@tsmono/inspect-common/testing";
import type { Event, ModelEvent } from "@tsmono/inspect-common/types";

import {
  deriveActivityData,
  fmtDurationWords,
  fmtTokens,
  hasEventTimestamps,
  rowHaystack,
} from "./activityData";

/** ISO timestamp `sec` seconds into a fixed run start. */
const kRunStart = Date.parse("2025-01-15T10:00:00.000Z") / 1000;
const iso = (sec: number): string =>
  new Date((kRunStart + sec) * 1000).toISOString();

/** A model call spanning [start, start+duration] wall seconds that worked
 *  for `working` seconds (defaults to the whole span). */
const modelCall = (opts: {
  start: number;
  duration: number;
  working?: number;
  workingStart: number;
  input?: number;
  cacheRead?: number;
  cacheWrite?: number;
  output?: number;
  retries?: number;
  model?: string;
  role?: string;
  uuid?: string;
  pending?: boolean;
}): ModelEvent =>
  testModelEvent({
    timestamp: iso(opts.start),
    completed: opts.pending ? undefined : iso(opts.start + opts.duration),
    working_start: opts.workingStart,
    working_time: opts.pending ? undefined : (opts.working ?? opts.duration),
    model: opts.model ?? "test-model",
    role: opts.role,
    uuid: opts.uuid,
    retries: opts.retries,
    pending: opts.pending,
    output: testModelOutput({
      usage: testModelUsage({
        input_tokens: opts.input ?? 0,
        input_tokens_cache_read: opts.cacheRead,
        input_tokens_cache_write: opts.cacheWrite,
        output_tokens: opts.output ?? 0,
        total_tokens:
          (opts.input ?? 0) +
          (opts.cacheRead ?? 0) +
          (opts.cacheWrite ?? 0) +
          (opts.output ?? 0),
      }),
    }),
  });

describe("hasEventTimestamps", () => {
  it("is false for old logs whose events lack timestamps", () => {
    const events: Event[] = [
      testModelEvent({ timestamp: "" }),
      testToolEvent({ timestamp: "" }),
    ];
    expect(hasEventTimestamps(events)).toBe(false);
  });

  it("is true when any event carries a timestamp", () => {
    expect(hasEventTimestamps([testModelEvent()])).toBe(true);
  });
});

describe("working / waiting derivation", () => {
  it("derives working segments and a stall from working-time drift", () => {
    // Call 1 works 0–10s; 20s of dead wall clock; call 2 works 30–40s.
    const events: Event[] = [
      modelCall({ start: 0, duration: 10, workingStart: 0 }),
      modelCall({ start: 30, duration: 10, workingStart: 10 }),
    ];
    const data = deriveActivityData({ events });

    expect(data.window).toEqual({ start: kRunStart, end: kRunStart + 40 });
    expect(data.workingSegments).toEqual([
      { start: kRunStart, end: kRunStart + 10 },
      { start: kRunStart + 30, end: kRunStart + 40 },
    ]);
    expect(data.stalls).toHaveLength(1);
    expect(data.stalls[0]).toMatchObject({
      start: kRunStart + 10,
      end: kRunStart + 30,
      duration: 20,
    });
    // Not retry-attributable — no history row for it.
    expect(data.stalls[0]?.retries).toBeUndefined();
    expect(data.rows).toHaveLength(0);
  });

  it("attributes a stall to an adjacent retrying model call", () => {
    // The retrying call's wall span [10, 40] contains the 25s of waiting
    // (working_time 5 « wall 30).
    const events: Event[] = [
      modelCall({ start: 0, duration: 10, workingStart: 0 }),
      modelCall({
        start: 10,
        duration: 30,
        working: 5,
        workingStart: 10,
        retries: 3,
        uuid: "retry-uuid",
      }),
    ];
    const data = deriveActivityData({ events });

    const stall = data.stalls.find((s) => s.retries !== undefined);
    expect(stall).toMatchObject({ retries: 3, uuid: "retry-uuid" });
    expect(stall?.duration).toBe(25);

    // Attributable stalls surface as an error history row with the model
    // event's uuid as click-through target.
    const stallRow = data.rows.find((r) => r.key.startsWith("stall:"));
    expect(stallRow).toMatchObject({
      category: "error",
      uuid: "retry-uuid",
      lead: "Model request rate-limited, retried ×3",
      detail: "resumed after 25s",
      by: "system",
    });
  });

  it("absorbs a working-clock reset without blanking later segments", () => {
    // Real logs: init-scope events carry working_start from a different
    // base (observed ~13 days) before it resets to ~0 for the run proper.
    // A global monotone clamp latched onto the garbage and rendered the
    // whole sample as waiting.
    const events: Event[] = [
      testModelEvent({
        timestamp: iso(0),
        completed: iso(2),
        working_start: 1_147_553,
        working_time: 2,
      }),
      modelCall({ start: 3, duration: 10, workingStart: 0.001 }),
      modelCall({ start: 13, duration: 10, workingStart: 10.001 }),
    ];
    const data = deriveActivityData({ events });
    // The run-proper work still renders: one merged block from 3s to 23s.
    const last = data.workingSegments[data.workingSegments.length - 1];
    expect(last).toEqual({ start: kRunStart + 3, end: kRunStart + 23 });
  });

  it("merges working blocks separated by sub-threshold noise", () => {
    const events: Event[] = [
      modelCall({ start: 0, duration: 10, workingStart: 0 }),
      modelCall({ start: 10.4, duration: 10, workingStart: 10.4 }),
    ];
    const data = deriveActivityData({ events });
    expect(data.workingSegments).toHaveLength(1);
    expect(data.stalls).toHaveLength(0);
  });

  it("sums working time from segments when the sample scalar is absent", () => {
    const events: Event[] = [
      modelCall({ start: 0, duration: 10, workingStart: 0 }),
      modelCall({ start: 30, duration: 10, workingStart: 10 }),
    ];
    const data = deriveActivityData({ events });
    expect(data.workingTime).toBe(20);
    expect(data.totalTime).toBe(40);
  });

  it("prefers the sample's own scalars when present", () => {
    const events: Event[] = [
      modelCall({ start: 0, duration: 10, workingStart: 0 }),
    ];
    const data = deriveActivityData({
      events,
      workingTime: 123,
      totalTime: 456,
    });
    expect(data.workingTime).toBe(123);
    expect(data.totalTime).toBe(456);
  });
});

describe("token burn", () => {
  it("accumulates input + cache read/write + output per model call", () => {
    const events: Event[] = [
      modelCall({
        start: 0,
        duration: 5,
        workingStart: 0,
        input: 100,
        cacheRead: 50,
        cacheWrite: 25,
        output: 25,
      }),
      modelCall({
        start: 10,
        duration: 5,
        workingStart: 5,
        input: 300,
        output: 100,
      }),
    ];
    const data = deriveActivityData({ events });

    expect(data.tokenSeries).toEqual([
      { time: kRunStart + 5, value: 200 },
      { time: kRunStart + 15, value: 600 },
    ]);
    expect(data.totalTokens).toBe(600);
  });

  it("skips model calls without usage (pending, errored)", () => {
    const events: Event[] = [
      testModelEvent({
        timestamp: iso(0),
        output: testModelOutput({ usage: undefined }),
      }),
    ];
    const data = deriveActivityData({ events });
    expect(data.tokenSeries).toHaveLength(0);
    expect(data.totalTokens).toBe(0);
  });
});

describe("context size", () => {
  it("plots input-side tokens per call and tracks the peak", () => {
    const events: Event[] = [
      modelCall({
        start: 0,
        duration: 5,
        workingStart: 0,
        input: 1000,
        cacheRead: 500,
        output: 100,
        uuid: "m1",
      }),
      modelCall({
        start: 10,
        duration: 5,
        workingStart: 5,
        input: 2000,
        cacheWrite: 500,
        output: 100,
        uuid: "m2",
      }),
    ];
    const data = deriveActivityData({ events });

    expect(data.contextSeries).toEqual([
      { time: kRunStart, value: 1500, uuid: "m1" },
      { time: kRunStart + 10, value: 2500, uuid: "m2" },
    ]);
    expect(data.contextPeak).toBe(2500);
  });

  it("derives compaction drops from tokens_before/tokens_after", () => {
    const events: Event[] = [
      modelCall({ start: 0, duration: 5, workingStart: 0, input: 142_000 }),
      testCompactionEvent({
        timestamp: iso(6),
        working_start: 5,
        tokens_before: 142_000,
        tokens_after: 38_000,
        uuid: "comp-1",
      }),
    ];
    const data = deriveActivityData({ events });

    expect(data.compactions).toEqual([
      {
        time: kRunStart + 6,
        before: 142_000,
        after: 38_000,
        key: "comp-1",
        uuid: "comp-1",
      },
    ]);
    const row = data.rows.find((r) => r.category === "compaction");
    expect(row?.mono).toBe("142k → 38k");
  });

  it("falls back to the last context value when tokens_before is absent", () => {
    const events: Event[] = [
      modelCall({ start: 0, duration: 5, workingStart: 0, input: 90_000 }),
      testCompactionEvent({
        timestamp: iso(6),
        working_start: 5,
        tokens_after: 30_000,
      }),
    ];
    const data = deriveActivityData({ events });
    expect(data.compactions[0]).toMatchObject({
      before: 90_000,
      after: 30_000,
    });
  });
});

describe("model & tool activity", () => {
  it("puts models and their tools on one row, graders on their own", () => {
    const events: Event[] = [
      modelCall({ start: 0, duration: 5, workingStart: 0, model: "opus" }),
      testToolEvent({
        timestamp: iso(5),
        completed: iso(8),
        working_start: 5,
        working_time: 3,
        function: "bash",
      }),
      modelCall({
        start: 20,
        duration: 4,
        workingStart: 8,
        model: "sonnet",
        role: "grader",
      }),
    ];
    const data = deriveActivityData({ events });

    expect(data.agentRows).toHaveLength(2);
    const [primary, grader] = data.agentRows;
    expect(primary).toMatchObject({
      model: "opus",
      role: undefined,
      modelCount: 1,
      toolCount: 1,
    });
    expect(primary?.spans.map((s) => s.kind)).toEqual(["model", "tool"]);
    expect(grader).toMatchObject({ model: "sonnet", role: "grader" });
  });

  it("splits concurrent tool calls into sub-lanes with a burst label", () => {
    const events: Event[] = [
      modelCall({ start: 0, duration: 2, workingStart: 0, model: "opus" }),
      testToolEvent({
        timestamp: iso(2),
        completed: iso(10),
        working_start: 2,
        function: "bash",
      }),
      testToolEvent({
        timestamp: iso(3),
        completed: iso(11),
        working_start: 2,
        function: "bash",
        error: { type: "unknown", message: "exit 127" },
      }),
      testToolEvent({
        timestamp: iso(4),
        completed: iso(12),
        working_start: 2,
        function: "bash",
      }),
      // Not overlapping the burst — stays a full-height span.
      testToolEvent({
        timestamp: iso(20),
        completed: iso(22),
        working_start: 10,
        function: "editor",
      }),
    ];
    const data = deriveActivityData({ events });

    const row = data.agentRows[0];
    const burstSpans = row?.spans.filter((s) => s.subLane !== undefined) ?? [];
    expect(burstSpans).toHaveLength(3);
    expect(burstSpans.map((s) => s.subLane)).toEqual([0, 1, 2]);
    expect(burstSpans.every((s) => s.subLaneCount === 3)).toBe(true);

    expect(row?.bursts).toHaveLength(1);
    expect(row?.bursts[0]).toMatchObject({
      count: 3,
      failed: 1,
      label: "bash",
      folded: 0,
    });

    const solo = row?.spans.find((s) => s.label === "editor");
    expect(solo?.subLane).toBeUndefined();
  });

  it("caps sub-lanes at 4 and folds the rest", () => {
    const tools: Event[] = Array.from({ length: 6 }, (_, i) =>
      testToolEvent({
        timestamp: iso(1 + i * 0.1),
        completed: iso(10),
        working_start: 1,
        function: "bash",
      })
    );
    const events: Event[] = [
      modelCall({ start: 0, duration: 1, workingStart: 0 }),
      ...tools,
    ];
    const data = deriveActivityData({ events });

    const row = data.agentRows[0];
    const laned = row?.spans.filter((s) => s.subLane !== undefined) ?? [];
    expect(laned).toHaveLength(4);
    expect(row?.bursts[0]).toMatchObject({ count: 6, folded: 2 });
  });

  it("marks failed tool calls and emits an error marker + row", () => {
    const events: Event[] = [
      modelCall({ start: 0, duration: 2, workingStart: 0 }),
      testToolEvent({
        timestamp: iso(2),
        completed: iso(4),
        working_start: 2,
        function: "bash",
        error: { type: "unknown", message: "exit 127" },
        uuid: "tool-1",
      }),
    ];
    const data = deriveActivityData({ events });

    expect(data.agentRows[0]?.failedCount).toBe(1);
    const marker = data.markers.find((m) => m.category === "error");
    expect(marker).toMatchObject({ key: "tool-1", uuid: "tool-1" });
    const row = data.rows.find((r) => r.category === "error");
    expect(row).toMatchObject({
      lead: "Tool",
      mono: "bash",
      tail: "errored",
      detail: "exit 127",
    });
  });
});

describe("markers and history rows", () => {
  it("generates one marker + row per incident category", () => {
    const events: Event[] = [
      modelCall({ start: 0, duration: 2, workingStart: 0 }),
      testErrorEvent({ timestamp: iso(1), uuid: "e1" }),
      testSampleLimitEvent({ timestamp: iso(2), type: "token", uuid: "e2" }),
      testApprovalEvent({
        timestamp: iso(3),
        approver: "charles",
        decision: "approve",
        uuid: "e3",
      }),
      testInputEvent({ timestamp: iso(4), input: "wrap it up", uuid: "e4" }),
      testInterruptEvent({ timestamp: iso(5), uuid: "e5" }),
      testCompactionEvent({
        timestamp: iso(6),
        tokens_before: 100_000,
        tokens_after: 20_000,
        uuid: "e6",
      }),
      testScoreEvent({ timestamp: iso(7), uuid: "e7" }),
    ];
    const data = deriveActivityData({ events });

    expect(data.markers.map((m) => m.category)).toEqual([
      "error",
      "limit",
      "approval",
      "input",
      "interrupt",
      "compaction",
      "score",
    ]);
    expect(data.rows.map((r) => r.category)).toEqual(
      data.markers.map((m) => m.category)
    );
    // Rows keyed by event uuid for the marker ↔ row hover link.
    expect(data.rows.map((r) => r.key)).toEqual([
      "e1",
      "e2",
      "e3",
      "e4",
      "e5",
      "e6",
      "e7",
    ]);
    // By column: approvals carry the approver, inputs the user.
    expect(data.rows.find((r) => r.category === "approval")?.by).toBe(
      "charles"
    );
    expect(data.rows.find((r) => r.category === "input")?.by).toBe("user");
  });

  it("falls back to a synthetic key when an event has no uuid", () => {
    const events: Event[] = [testErrorEvent({ timestamp: iso(0), uuid: null })];
    const data = deriveActivityData({ events });
    expect(data.markers[0]?.key).toBe("evt:0");
    expect(data.markers[0]?.uuid).toBeUndefined();
  });

  it("markers and rows are time-sorted regardless of event order", () => {
    const events: Event[] = [
      testScoreEvent({ timestamp: iso(10), uuid: "late" }),
      testErrorEvent({ timestamp: iso(1), uuid: "early" }),
    ];
    const data = deriveActivityData({ events });
    expect(data.markers.map((m) => m.key)).toEqual(["early", "late"]);
    expect(data.rows.map((r) => r.key)).toEqual(["early", "late"]);
  });

  it("builds a searchable haystack from every sentence part", () => {
    const events: Event[] = [
      testApprovalEvent({
        timestamp: iso(0),
        approver: "charles",
        decision: "approve",
      }),
    ];
    const data = deriveActivityData({ events });
    const haystack = rowHaystack(data.rows[0]!).toLowerCase();
    expect(haystack).toContain("approval");
    expect(haystack).toContain("test_tool");
    expect(haystack).toContain("charles");
  });
});

describe("pending / running samples", () => {
  it("renders pending spans open-ended to now", () => {
    const nowSec = kRunStart + 100;
    const events: Event[] = [
      modelCall({ start: 0, duration: 5, workingStart: 0 }),
      modelCall({ start: 10, duration: 0, workingStart: 5, pending: true }),
    ];
    const data = deriveActivityData({ events, running: true, now: nowSec });

    expect(data.pending).toBe(true);
    expect(data.window?.end).toBe(nowSec);
    const open = data.agentRows[0]?.spans.find((s) => s.pending);
    expect(open?.end).toBe(nowSec);
    // The working band extends past the last checkpoint on a live sample.
    const lastSegment = data.workingSegments[data.workingSegments.length - 1];
    expect(lastSegment?.end).toBe(nowSec);
  });

  it("does not extend a completed sample past its last event", () => {
    const events: Event[] = [
      modelCall({ start: 0, duration: 5, workingStart: 0 }),
    ];
    const data = deriveActivityData({ events, now: kRunStart + 500 });
    expect(data.window?.end).toBe(kRunStart + 5);
  });
});

describe("zero-ModelEvent samples", () => {
  it("keeps working/waiting and markers meaningful with empty curves", () => {
    const events: Event[] = [
      testErrorEvent({ timestamp: iso(1), uuid: "e1" }),
      testScoreEvent({ timestamp: iso(9), uuid: "s1" }),
    ];
    const data = deriveActivityData({ events });

    expect(data.tokenSeries).toHaveLength(0);
    expect(data.contextSeries).toHaveLength(0);
    expect(data.agentRows).toHaveLength(0);
    expect(data.window).toEqual({ start: kRunStart + 1, end: kRunStart + 9 });
    expect(data.markers).toHaveLength(2);
    expect(data.rows).toHaveLength(2);
  });

  it("returns an inert shape for a sample with no timestamped events", () => {
    const data = deriveActivityData({
      events: [testModelEvent({ timestamp: "" })],
    });
    expect(data.window).toBeUndefined();
    expect(data.workingSegments).toHaveLength(0);
    expect(data.markers).toHaveLength(0);
  });
});

describe("formatting", () => {
  it("formats durations in handoff style", () => {
    expect(fmtDurationWords(45)).toBe("45s");
    expect(fmtDurationWords(135)).toBe("2m 15s");
    expect(fmtDurationWords(600)).toBe("10m");
    expect(fmtDurationWords(3720)).toBe("1h 2m");
    expect(fmtDurationWords(-1)).toBe("—");
  });

  it("formats token counts in handoff style", () => {
    expect(fmtTokens(950)).toBe("950");
    expect(fmtTokens(38_000)).toBe("38k");
    expect(fmtTokens(183_400)).toBe("183k");
    expect(fmtTokens(1_500_000)).toBe("1.5M");
  });
});
