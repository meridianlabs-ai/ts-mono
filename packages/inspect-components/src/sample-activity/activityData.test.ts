import { describe, expect, it } from "vitest";

import { normalizeEvents } from "@tsmono/inspect-common/normalize";
import {
  testApprovalEvent,
  testAssistantMessage,
  testChatCompletionChoice,
  testCompactionEvent,
  testErrorEvent,
  testInputEvent,
  testInterruptEvent,
  testModelEvent,
  testModelOutput,
  testModelUsage,
  testSampleLimitEvent,
  testScoreEvent,
  testSentinelEvent,
  testSpanBeginEvent,
  testSpanEndEvent,
  testSubtaskEvent,
  testToolCall,
  testToolEvent,
} from "@tsmono/inspect-common/testing";
import type {
  Event,
  ModelEvent,
  SentinelEvent,
  ToolEvent,
} from "@tsmono/inspect-common/types";

import {
  deriveActivityData,
  fmtDurationWords,
  fmtTokens,
  hasEventTimestamps,
  kAgentHues,
  kCategoryLong,
  kScorerHue,
  parallelContextGroups,
  rowHaystack,
  rowKind,
  turnAfter,
  turnAt,
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
  spanId?: string;
}): ModelEvent =>
  testModelEvent({
    timestamp: iso(opts.start),
    completed: opts.pending ? undefined : iso(opts.start + opts.duration),
    working_start: opts.workingStart,
    working_time: opts.pending ? undefined : (opts.working ?? opts.duration),
    model: opts.model ?? "test-model",
    role: opts.role,
    span_id: opts.spanId,
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

  it("reports no working signal for mid-vintage logs (timestamps, no working clock)", () => {
    // Real vintage: event timestamps exist but working_start predates the
    // field (normalizer fills 0) and working_time is absent. An all-zero
    // work clock must not render the whole run as waiting.
    const events: Event[] = [
      testModelEvent({
        timestamp: iso(0),
        completed: iso(10),
        working_start: 0,
        working_time: null,
      }),
      testModelEvent({
        timestamp: iso(30),
        completed: iso(40),
        working_start: 0,
        working_time: null,
      }),
    ];
    const data = deriveActivityData({ events });

    expect(data.hasWorkingSignal).toBe(false);
    expect(data.workingSegments).toHaveLength(0);
    expect(data.stalls).toHaveLength(0);
    // The rest of the derivation still works off the timestamps.
    expect(data.window).toEqual({ start: kRunStart, end: kRunStart + 40 });
    expect(data.agentRows).toHaveLength(1);
  });

  it("reports a working signal from working_time or nonzero working_start", () => {
    const viaWorkingTime = deriveActivityData({
      events: [modelCall({ start: 0, duration: 10, workingStart: 0 })],
    });
    expect(viaWorkingTime.hasWorkingSignal).toBe(true);

    const viaWorkingStart = deriveActivityData({
      events: [
        testModelEvent({
          timestamp: iso(5),
          working_start: 5,
          working_time: null,
        }),
      ],
    });
    expect(viaWorkingStart.hasWorkingSignal).toBe(true);
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

  it("time-sorts the series when overlapping calls complete out of order", () => {
    // Call A spans the whole window and completes LAST; call B (a parallel
    // subagent / concurrent scorer) completes first. Points pushed in event
    // order would go backwards at A's completion.
    const events: Event[] = [
      modelCall({
        start: 0,
        duration: 100,
        workingStart: 0,
        input: 1000,
        uuid: "outer",
      }),
      modelCall({
        start: 10,
        duration: 10,
        workingStart: 0,
        input: 500,
        uuid: "inner",
      }),
    ];
    const data = deriveActivityData({ events });

    expect(data.tokenSeries).toEqual([
      { time: kRunStart + 20, value: 500 },
      { time: kRunStart + 100, value: 1500 },
    ]);
    expect(data.totalTokens).toBe(1500);
  });

  it("prefers the recorded total over the category composition", () => {
    // OpenAI-style usage: input_tokens already includes the cached reads,
    // so summing categories would double-count (1000+400+100 = 1500).
    const events: Event[] = [
      testModelEvent({
        timestamp: iso(0),
        completed: iso(5),
        working_start: 0,
        working_time: 5,
        output: testModelOutput({
          usage: testModelUsage({
            input_tokens: 1000,
            input_tokens_cache_read: 400,
            output_tokens: 100,
            total_tokens: 1100,
          }),
        }),
      }),
    ];
    const data = deriveActivityData({ events });

    expect(data.totalTokens).toBe(1100);
    // Context (input side) derives from the same total minus output.
    expect(data.contextSeries[0]?.value).toBe(1000);
  });

  it("reads context from input_context_tokens, not billed usage", () => {
    // A call that made several requests: usage is billed over all of them,
    // input_context_tokens is the one request built from the input.
    const events: Event[] = [
      testModelEvent({
        timestamp: iso(0),
        completed: iso(5),
        working_start: 0,
        working_time: 5,
        output: testModelOutput({
          usage: testModelUsage({
            input_tokens: 3000,
            input_tokens_cache_read: 300,
            output_tokens: 90,
            total_tokens: 3390,
          }),
          input_context_tokens: 1000,
        }),
      }),
    ];
    const data = deriveActivityData({ events });

    expect(data.totalTokens).toBe(3390);
    expect(data.contextSeries[0]?.value).toBe(1000);
    expect(data.contextPeak).toBe(1000);
    expect(data.agentRows[0]?.spans[0]?.inputTokens).toBe(1000);
  });

  const billedOnly = (inputContextTokens?: number | null): Event[] => {
    const output = testModelOutput({
      usage: testModelUsage({
        input_tokens: 3000,
        input_tokens_cache_read: 300,
        output_tokens: 90,
        total_tokens: 3390,
      }),
    });
    if (inputContextTokens !== undefined) {
      output.input_context_tokens = inputContextTokens;
    }
    return [
      testModelEvent({
        timestamp: iso(0),
        completed: iso(5),
        working_start: 0,
        working_time: 5,
        output,
      }),
    ];
  };

  it.each([
    ["absent (older logs)", undefined],
    ["null (not known)", null],
  ] as const)(
    "falls back to usage when input_context_tokens is %s",
    (_label, inputContextTokens) => {
      const data = deriveActivityData({
        events: billedOnly(inputContextTokens),
      });

      expect(data.totalTokens).toBe(3390);
      expect(data.contextSeries[0]?.value).toBe(3300);
      expect(data.agentRows[0]?.spans[0]?.inputTokens).toBe(3300);
    }
  );

  it.each([
    ["zero (unknown)", 0],
    ["negative", -1],
    ["above the safe integer range", 1e308],
  ])(
    "falls back to usage when input_context_tokens is %s",
    (_label, inputContextTokens) => {
      const data = deriveActivityData({
        events: billedOnly(inputContextTokens),
      });

      expect(data.contextSeries[0]?.value).toBe(3300);
      expect(data.agentRows[0]?.spans[0]?.inputTokens).toBe(3300);
      expect(data.agentRows[0]?.spans[0]?.cachedTokens).toBe(300);
    }
  );

  it("reads input_context_tokens when the call has no usage", () => {
    const output = testModelOutput({ usage: undefined });
    output.input_context_tokens = 1000;
    const events: Event[] = [
      testModelEvent({
        timestamp: iso(0),
        completed: iso(5),
        working_start: 0,
        working_time: 5,
        output,
      }),
    ];
    const data = deriveActivityData({ events });

    expect(data.contextSeries[0]?.value).toBe(1000);
    expect(data.contextPeak).toBe(1000);
    expect(data.agentRows[0]?.spans[0]?.inputTokens).toBe(1000);
    // no usage, so nothing burned
    expect(data.totalTokens).toBe(0);
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
  it("orders a fan-out's context points by turn, not event order", () => {
    // Three calls issued together share a start; the turns sort by
    // completion within it, so the context series — the order Turns mode
    // emits the line's vertices in — must follow the turn index, or the
    // line walks backwards across the fan-out's columns.
    const events: Event[] = [
      modelCall({
        start: 0,
        duration: 5,
        workingStart: 0,
        input: 100,
        uuid: "m0",
      }),
      modelCall({
        start: 10,
        duration: 15,
        workingStart: 10,
        input: 1470,
        uuid: "a",
      }),
      modelCall({
        start: 10,
        duration: 5,
        workingStart: 10,
        input: 984,
        uuid: "b",
      }),
      modelCall({
        start: 10,
        duration: 10,
        workingStart: 10,
        input: 1200,
        uuid: "c",
      }),
    ];
    const data = deriveActivityData({ events });
    expect(data.contextSeries.map((p) => p.turn)).toEqual([1, 2, 3, 4]);
    expect(data.contextSeries.map((p) => p.uuid)).toEqual([
      "m0",
      "b",
      "c",
      "a",
    ]);
    // Deltas follow the same order, and every point knows when its call ended.
    expect(data.contextByRow.root?.map((p) => p.delta)).toEqual([
      undefined,
      884,
      216,
      270,
    ]);
    expect(data.contextSeries.map((p) => p.end - kRunStart)).toEqual([
      5, 15, 20, 25,
    ]);
  });

  it("groups a row's parallel calls and leaves sequential and follow-up calls alone", () => {
    const events: Event[] = [
      modelCall({
        start: 0,
        duration: 5,
        workingStart: 0,
        input: 100,
        uuid: "m0",
      }),
      // A fan-out: issued within the same second, all running at once.
      modelCall({
        start: 10,
        duration: 15,
        workingStart: 10,
        input: 1470,
        uuid: "a",
      }),
      modelCall({
        start: 10.2,
        duration: 5,
        workingStart: 10,
        input: 984,
        uuid: "b",
      }),
      modelCall({
        start: 10.4,
        duration: 10,
        workingStart: 10,
        input: 1200,
        uuid: "c",
      }),
      // Overlaps `a` but was issued 5 s later: a follow-up, not a fan-out.
      modelCall({
        start: 15,
        duration: 20,
        workingStart: 15,
        input: 1600,
        uuid: "d",
      }),
      modelCall({
        start: 40,
        duration: 5,
        workingStart: 40,
        input: 1700,
        uuid: "e",
      }),
    ];
    const data = deriveActivityData({ events });
    const groups = parallelContextGroups(data.contextByRow.root ?? []);
    expect(groups.map((group) => group.map((p) => p.uuid))).toEqual([
      ["m0"],
      ["a", "b", "c"],
      ["d"],
      ["e"],
    ]);
    // Same start, but the first call is over before the second begins:
    // sequential, however close the timestamps.
    const quick = deriveActivityData({
      events: [
        modelCall({
          start: 0,
          duration: 0.1,
          workingStart: 0,
          input: 100,
          uuid: "p",
        }),
        modelCall({
          start: 0.2,
          duration: 1,
          workingStart: 0.2,
          input: 200,
          uuid: "q",
        }),
      ],
    });
    expect(
      parallelContextGroups(quick.contextByRow.root ?? []).map((g) => g.length)
    ).toEqual([1, 1]);
  });

  it("splits a fan-out at a compaction that lands between its members' starts", () => {
    // `a` and `b` start 0.4 s apart with both still running — a fan-out by
    // the grouping rule — but the compaction at 10.2 s changed the context
    // between them, so they are drawn on either side of the cliff.
    const data = deriveActivityData({
      events: [
        modelCall({
          start: 10,
          duration: 10,
          workingStart: 10,
          input: 200,
          uuid: "a",
        }),
        testCompactionEvent({
          uuid: "compact",
          timestamp: iso(10.2),
          tokens_before: 200,
          tokens_after: 80,
        }),
        modelCall({
          start: 10.4,
          duration: 15,
          workingStart: 10.4,
          input: 300,
          uuid: "b",
        }),
      ],
    });
    const points = data.contextByRow.root ?? [];
    const ids = (groups: (typeof points)[]) =>
      groups.map((group) => group.map((p) => p.uuid));
    expect(ids(parallelContextGroups(points))).toEqual([["a", "b"]]);
    expect(
      ids(
        parallelContextGroups(
          points,
          data.compactions.map((drop) => drop.time)
        )
      )
    ).toEqual([["a"], ["b"]]);
    // A drop at the group's first start precedes the whole group (the
    // line applies it before the node); one at a later member's start
    // splits before that member.
    const [a, b] = points;
    if (!a || !b) throw new Error("expected two points");
    expect(ids(parallelContextGroups(points, [a.time]))).toEqual([["a", "b"]]);
    expect(ids(parallelContextGroups(points, [b.time]))).toEqual([
      ["a"],
      ["b"],
    ]);
  });

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
      {
        time: kRunStart,
        end: kRunStart + 5,
        value: 1500,
        uuid: "m1",
        rowId: "root",
        messages: 0,
        turn: 1,
      },
      {
        time: kRunStart + 10,
        end: kRunStart + 15,
        value: 2500,
        uuid: "m2",
        rowId: "root",
        messages: 0,
        delta: 1000,
        turn: 2,
      },
    ]);
    expect(data.contextPeak).toBe(2500);
    expect(data.contextByRow.root).toHaveLength(2);
    expect(data.contextPeakByRow.root).toBe(2500);
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
        rowId: "root",
        before: 142_000,
        after: 38_000,
        strategy: "summary",
        key: "comp-1",
        uuid: "comp-1",
        turn: 1,
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
  it("falls back to the call's input_context_tokens, not its billed usage", () => {
    const call = modelCall({
      start: 0,
      duration: 5,
      workingStart: 0,
      input: 90_000,
    });
    call.output.input_context_tokens = 40_000;
    const events: Event[] = [
      call,
      testCompactionEvent({
        timestamp: iso(6),
        working_start: 5,
        tokens_after: 30_000,
      }),
    ];
    const data = deriveActivityData({ events });
    expect(data.compactions[0]).toMatchObject({
      before: 40_000,
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
    // Membership is independent of lane assignment: every member points
    // at the burst, the two past the cap are folded and lane-less.
    const members = row?.spans.filter((s) => s.kind === "tool") ?? [];
    expect(members.every((s) => s.burst === row?.bursts[0])).toBe(true);
    const folded = members.filter((s) => s.folded);
    expect(folded).toHaveLength(2);
    expect(folded.every((s) => s.subLane === undefined)).toBe(true);
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

describe("conversations (handoff 10a)", () => {
  /** An agent span with its begin/end events around `body`. */
  const agentSpan = (
    id: string,
    name: string,
    parentId: string | undefined,
    startSec: number,
    endSec: number,
    type = "agent"
  ): { begin: Event; end: Event } => ({
    begin: testSpanBeginEvent({
      id,
      name,
      type,
      parent_id: parentId,
      timestamp: iso(startSec),
      working_start: startSec,
    }),
    end: testSpanEndEvent({
      id,
      timestamp: iso(endSec),
      working_start: endSec,
    }),
  });

  it("keys rows on the nearest agent/subtask/solver span, tools included", () => {
    // solvers → solver "react" → agent "react" (the top conversation);
    // a hand-off tool spawns handoff → tool → agent "analyst".
    const solvers = agentSpan(
      "solvers",
      "solvers",
      undefined,
      0,
      60,
      "solvers"
    );
    const solver = agentSpan("solver", "react", "solvers", 0, 60, "solver");
    const react = agentSpan("react", "react", "solver", 0, 60);
    const handoff = agentSpan("handoff", "analyst", "react", 12, 30, "handoff");
    const transfer = agentSpan(
      "transfer",
      "transfer_to_analyst",
      "handoff",
      12,
      30,
      "tool"
    );
    const analyst = agentSpan("analyst", "analyst", "transfer", 13, 29);
    const events: Event[] = [
      solvers.begin,
      solver.begin,
      react.begin,
      modelCall({
        start: 0,
        duration: 10,
        workingStart: 0,
        model: "opus",
        spanId: "react",
        input: 1000,
        uuid: "m-react-1",
      }),
      testToolEvent({
        timestamp: iso(10),
        completed: iso(30),
        working_start: 10,
        working_time: 20,
        function: "transfer_to_analyst",
        span_id: "react",
        uuid: "t-transfer",
      }),
      handoff.begin,
      transfer.begin,
      analyst.begin,
      modelCall({
        start: 13,
        duration: 5,
        workingStart: 13,
        model: "haiku",
        spanId: "analyst",
        input: 500,
        uuid: "m-analyst-1",
      }),
      testToolEvent({
        timestamp: iso(18),
        completed: iso(22),
        working_start: 18,
        working_time: 4,
        function: "string_reverse",
        span_id: "analyst",
        uuid: "t-analyst",
      }),
      modelCall({
        start: 22,
        duration: 6,
        workingStart: 22,
        model: "haiku",
        spanId: "analyst",
        input: 700,
        uuid: "m-analyst-2",
      }),
      analyst.end,
      transfer.end,
      handoff.end,
      modelCall({
        start: 30,
        duration: 10,
        workingStart: 30,
        model: "opus",
        spanId: "react",
        input: 2000,
        uuid: "m-react-2",
      }),
      react.end,
      solver.end,
      solvers.end,
    ];
    const data = deriveActivityData({ events });

    expect(data.agentRows.map((row) => row.id)).toEqual(["react", "analyst"]);
    const [parent, child] = data.agentRows;
    expect(parent).toMatchObject({
      name: "react",
      model: "opus",
      isSubAgent: false,
      modelCount: 2,
      toolCount: 1,
      hue: kAgentHues[0],
    });
    expect(child).toMatchObject({
      name: "analyst",
      model: "haiku",
      isSubAgent: true,
      modelCount: 2,
      toolCount: 1,
      hue: kAgentHues[1],
    });
    // The spawning tool call hands off; the parent waits on the child span.
    const transferSpan = parent?.spans.find((s) => s.uuid === "t-transfer");
    expect(transferSpan?.handoffTo).toBe("analyst");
    expect(parent?.blockedOn).toEqual([
      {
        start: kRunStart + 13,
        end: kRunStart + 29,
        childId: "analyst",
        childName: "analyst",
      },
    ]);
    expect(child?.blockedOn).toEqual([]);
  });

  it("falls back to one root row when events carry no span context", () => {
    const events: Event[] = [
      modelCall({ start: 0, duration: 5, workingStart: 0, model: "opus" }),
      testToolEvent({
        timestamp: iso(5),
        completed: iso(8),
        working_start: 5,
        function: "bash",
      }),
    ];
    const data = deriveActivityData({ events });
    expect(data.agentRows).toHaveLength(1);
    expect(data.agentRows[0]).toMatchObject({
      id: "root",
      name: "opus",
      model: "opus",
      isSubAgent: false,
      toolCount: 1,
    });
  });

  it("keeps a model swap inside one span on the same row", () => {
    const react = agentSpan("react", "react", undefined, 0, 30);
    const events: Event[] = [
      react.begin,
      modelCall({
        start: 0,
        duration: 5,
        workingStart: 0,
        model: "opus",
        spanId: "react",
      }),
      modelCall({
        start: 10,
        duration: 5,
        workingStart: 5,
        model: "sonnet",
        spanId: "react",
      }),
      react.end,
    ];
    const data = deriveActivityData({ events });
    expect(data.agentRows).toHaveLength(1);
    expect(data.agentRows[0]).toMatchObject({
      model: "sonnet",
      models: ["opus", "sonnet"],
    });
  });

  it("gives role and scorer-span calls their own grey rows, sorted last", () => {
    const scorers = agentSpan(
      "scorers",
      "scorers",
      undefined,
      20,
      30,
      "scorers"
    );
    const scorer = agentSpan(
      "scorer",
      "model_graded_qa",
      "scorers",
      20,
      30,
      "scorer"
    );
    const events: Event[] = [
      // Grader role call logged BEFORE the primary — still sorts after it.
      modelCall({
        start: 0,
        duration: 2,
        workingStart: 0,
        model: "sonnet",
        role: "grader",
      }),
      modelCall({ start: 2, duration: 5, workingStart: 2, model: "opus" }),
      scorers.begin,
      scorer.begin,
      modelCall({
        start: 21,
        duration: 3,
        workingStart: 7,
        model: "sonnet",
        spanId: "scorer",
      }),
      scorer.end,
      scorers.end,
    ];
    const data = deriveActivityData({ events });
    expect(data.agentRows.map((row) => row.id)).toEqual([
      "root",
      "role:grader",
      "scorer:model_graded_qa",
    ]);
    expect(data.agentRows[1]).toMatchObject({
      name: "grader",
      role: "grader",
      hue: kScorerHue,
    });
    expect(data.agentRows[2]).toMatchObject({
      name: "model_graded_qa",
      role: "scorer",
      hue: kScorerHue,
    });
    expect(data.agentRows[0]?.hue).toBe(kAgentHues[0]);
  });

  it("cycles hues past the palette", () => {
    const events: Event[] = [];
    for (let i = 0; i < 6; i++) {
      const span = agentSpan(
        `a${i}`,
        `agent-${i}`,
        undefined,
        i * 10,
        i * 10 + 5
      );
      events.push(
        span.begin,
        modelCall({
          start: i * 10,
          duration: 5,
          workingStart: i * 10,
          spanId: `a${i}`,
        }),
        span.end
      );
    }
    const data = deriveActivityData({ events });
    expect(data.agentRows.map((row) => row.hue)).toEqual([
      ...kAgentHues,
      kAgentHues[0],
      kAgentHues[1],
    ]);
  });

  it("splits token burn and context per row while keeping the totals", () => {
    const a = agentSpan("a", "orchestrator", undefined, 0, 40);
    const b = agentSpan("b", "researcher", "a", 10, 30);
    const events: Event[] = [
      a.begin,
      modelCall({
        start: 0,
        duration: 5,
        workingStart: 0,
        spanId: "a",
        input: 1000,
        output: 100,
      }),
      b.begin,
      modelCall({
        start: 10,
        duration: 5,
        workingStart: 5,
        spanId: "b",
        input: 500,
        output: 50,
      }),
      modelCall({
        start: 20,
        duration: 5,
        workingStart: 10,
        spanId: "b",
        input: 600,
        output: 60,
      }),
      b.end,
      modelCall({
        start: 30,
        duration: 5,
        workingStart: 15,
        spanId: "a",
        input: 2000,
        output: 200,
      }),
      a.end,
    ];
    const data = deriveActivityData({ events });

    expect(data.totalTokens).toBe(1100 + 550 + 660 + 2200);
    expect(data.tokenSeries.map((p) => p.value)).toEqual([
      1100, 1650, 2310, 4510,
    ]);
    expect(data.tokensByRow.a?.map((p) => p.value)).toEqual([1100, 3300]);
    expect(data.tokensByRow.b?.map((p) => p.value)).toEqual([550, 1210]);
    expect(data.tokenTotalsByRow).toEqual({ a: 3300, b: 1210 });
    // The stacked total equals the sum of the row totals.
    expect(data.tokenTotalsByRow.a! + data.tokenTotalsByRow.b!).toBe(
      data.totalTokens
    );

    expect(data.contextByRow.a?.map((p) => p.value)).toEqual([1000, 2000]);
    expect(data.contextByRow.b?.map((p) => p.value)).toEqual([500, 600]);
    expect(data.contextByRow.b?.[0]?.time).toBe(kRunStart + 10);
    expect(data.contextPeakByRow).toEqual({ a: 2000, b: 600 });
    expect(data.contextPeak).toBe(2000);
  });
});

describe("conversations (review round 1)", () => {
  it("survives conversation ids named after Object.prototype members", () => {
    // Span ids come straight from the log; a plain {} record would resolve
    // "constructor" / "__proto__" / "toString" to inherited builtins.
    const ids = ["constructor", "__proto__", "toString"];
    const events: Event[] = ids.flatMap((id, i) => [
      testSpanBeginEvent({ id, name: id, type: "agent", timestamp: iso(i) }),
      modelCall({
        start: i * 10,
        duration: 5,
        workingStart: i * 10,
        input: 100,
        spanId: id,
        uuid: `m-${i}`,
      }),
      testCompactionEvent({
        span_id: id,
        timestamp: iso(i * 10 + 6),
        working_start: i * 10 + 5,
        tokens_after: 10,
      }),
    ]);
    const data = deriveActivityData({ events });
    expect(data.agentRows.map((row) => row.id)).toEqual(ids);
    for (const id of ids) {
      expect(data.tokensByRow[id]).toHaveLength(1);
      expect(data.tokenTotalsByRow[id]).toBe(100);
      expect(data.contextByRow[id]).toHaveLength(1);
      expect(data.contextPeakByRow[id]).toBe(100);
    }
    expect(data.compactions.map((drop) => drop.before)).toEqual([
      100, 100, 100,
    ]);
    // Absent keys read as absent, not as builtins.
    expect("valueOf" in data.tokensByRow).toBe(false);
    expect(Object.getPrototypeOf(data.tokensByRow)).toBeNull();
  });

  it("keeps a role model's tools and approvals on the role row", () => {
    // Under a scorer span the grader model keys on its role; the tool it
    // issued (same span_id) must land on that same row and turn.
    const events: Event[] = [
      testSpanBeginEvent({
        id: "grading",
        name: "quality",
        type: "scorer",
        timestamp: iso(0),
      }),
      modelCall({
        start: 0,
        duration: 10,
        workingStart: 0,
        input: 100,
        role: "grader",
        spanId: "grading",
        uuid: "g1",
      }),
      testToolEvent({
        uuid: "g1-tool",
        span_id: "grading",
        timestamp: iso(10),
        completed: iso(20),
        working_start: 10,
        working_time: 10,
      }),
      testApprovalEvent({
        uuid: "g1-reject",
        span_id: "grading",
        timestamp: iso(21),
        decision: "reject",
      }),
    ];
    const data = deriveActivityData({ events });
    expect(data.agentRows).toHaveLength(1);
    expect(data.agentRows[0]).toMatchObject({
      id: "role:grader",
      modelCount: 1,
      toolCount: 1,
    });
    expect(data.turns).toHaveLength(1);
    expect(data.turns[0]?.tools.map((tool) => tool.uuid)).toEqual(["g1-tool"]);
    expect(data.turns[0]?.rejected).toBe(1);
  });

  it("attributes span-less tools to the conversation that last called a model", () => {
    // No span context anywhere (older logs): the grader's tool follows the
    // grader model, not the root conversation.
    const events: Event[] = [
      modelCall({ start: 0, duration: 5, workingStart: 0, uuid: "root-1" }),
      modelCall({
        start: 5,
        duration: 5,
        workingStart: 5,
        role: "grader",
        uuid: "grader-1",
      }),
      testToolEvent({
        uuid: "grader-tool",
        timestamp: iso(10),
        completed: iso(12),
        working_start: 10,
        working_time: 2,
      }),
      modelCall({ start: 12, duration: 5, workingStart: 12, uuid: "root-2" }),
      testToolEvent({
        uuid: "root-tool",
        timestamp: iso(17),
        completed: iso(18),
        working_start: 17,
        working_time: 1,
      }),
    ];
    const data = deriveActivityData({ events });
    const byId = new Map(data.agentRows.map((row) => [row.id, row]));
    expect(byId.get("root")?.spans.map((span) => span.uuid)).toEqual([
      "root-1",
      "root-2",
      "root-tool",
    ]);
    expect(byId.get("role:grader")?.spans.map((span) => span.uuid)).toEqual([
      "grader-1",
      "grader-tool",
    ]);
    expect(data.turns).toHaveLength(3);
  });

  it("tracks the compaction fallback context per conversation", () => {
    // A reports 100, B reports 900, then A compacts without tokens_before:
    // A's drop starts from its own 100, not B's 900.
    const events: Event[] = [
      testSpanBeginEvent({ id: "a", type: "agent", timestamp: iso(0) }),
      testSpanBeginEvent({ id: "b", type: "agent", timestamp: iso(0) }),
      modelCall({
        start: 0,
        duration: 5,
        workingStart: 0,
        input: 100,
        spanId: "a",
        uuid: "a1",
      }),
      modelCall({
        start: 5,
        duration: 5,
        workingStart: 5,
        input: 900,
        spanId: "b",
        uuid: "b1",
      }),
      testCompactionEvent({
        span_id: "a",
        timestamp: iso(11),
        working_start: 10,
        tokens_after: 20,
      }),
      testCompactionEvent({
        span_id: "a",
        timestamp: iso(12),
        working_start: 11,
        tokens_after: 5,
      }),
    ];
    const data = deriveActivityData({ events });
    expect(data.compactions.map((drop) => [drop.rowId, drop.before])).toEqual([
      ["a", 100],
      ["a", 20],
    ]);
  });
});

describe("turns (handoff 8b)", () => {
  it("groups each model call with the tool calls it issued, interleaving rows", () => {
    const events: Event[] = [
      modelCall({
        start: 0,
        duration: 4,
        workingStart: 0,
        model: "opus",
        uuid: "m1",
        input: 100,
      }),
      testToolEvent({
        timestamp: iso(4),
        completed: iso(10),
        working_start: 4,
        working_time: 6,
        function: "bash",
        uuid: "t1",
      }),
      testToolEvent({
        timestamp: iso(5),
        completed: iso(9),
        working_start: 4,
        working_time: 4,
        function: "bash",
        uuid: "t2",
      }),
      // Grader turn between two primary turns.
      modelCall({
        start: 12,
        duration: 3,
        workingStart: 10,
        model: "sonnet",
        role: "grader",
        uuid: "g1",
        input: 100,
      }),
      modelCall({
        start: 20,
        duration: 5,
        workingStart: 13,
        model: "opus",
        uuid: "m2",
        input: 100,
      }),
    ];
    const data = deriveActivityData({ events });

    expect(data.turns.map((turn) => turn.index)).toEqual([1, 2, 3]);
    expect(data.turns.map((turn) => turn.rowId)).toEqual([
      "root",
      "role:grader",
      "root",
    ]);
    const [first, grader, last] = data.turns;
    expect(first).toMatchObject({
      start: kRunStart,
      end: kRunStart + 10,
      modelWork: 4,
      toolWork: 10,
      rejected: 0,
    });
    expect(first?.model?.uuid).toBe("m1");
    expect(first?.tools.map((t) => t.uuid)).toEqual(["t1", "t2"]);
    expect(grader).toMatchObject({
      start: kRunStart + 12,
      end: kRunStart + 15,
    });
    expect(last?.tools).toHaveLength(0);
    // Spans and curve points carry their turn index.
    expect(data.agentRows[0]?.spans.map((s) => s.turn)).toEqual([1, 1, 1, 3]);
    expect(data.contextSeries.map((p) => p.turn)).toEqual([1, 2, 3]);
    expect(data.tokenPoints.map((p) => p.turn)).toEqual([1, 2, 3]);
  });

  it("links curve points to their turn without event uuids", () => {
    // Pre-uuid logs: the burn/context points still know which turn made
    // them, so Turns mode can place them inside the turn's own column.
    const events: Event[] = [
      modelCall({ start: 0, duration: 10, workingStart: 0, input: 100 }),
      modelCall({ start: 20, duration: 10, workingStart: 20, input: 200 }),
    ];
    const data = deriveActivityData({ events });
    expect(data.tokenPoints.map((point) => point.turn)).toEqual([1, 2]);
    expect(data.contextSeries.map((point) => point.turn)).toEqual([1, 2]);
  });

  it("carries working seconds on every span for the column split", () => {
    const events: Event[] = [
      modelCall({ start: 0, duration: 10, working: 4, workingStart: 0 }),
      testToolEvent({
        timestamp: iso(10),
        completed: iso(100),
        working_start: 4,
        working_time: 10,
      }),
    ];
    const data = deriveActivityData({ events });
    const [turn] = data.turns;
    expect(turn?.model?.working).toBe(4);
    expect(turn?.tools[0]?.working).toBe(10);
    expect(turn).toMatchObject({ modelWork: 4, toolWork: 10 });
  });

  it("locates markers inside a turn and snaps between-turn markers forward", () => {
    const events: Event[] = [
      modelCall({ start: 0, duration: 4, workingStart: 0, uuid: "m1" }),
      testToolEvent({
        timestamp: iso(4),
        completed: iso(8),
        working_start: 4,
        function: "bash",
        error: { type: "unknown", message: "exit 127" },
        uuid: "t1",
      }),
      testCompactionEvent({
        timestamp: iso(9),
        working_start: 8,
        tokens_before: 100,
        tokens_after: 10,
      }),
      modelCall({ start: 10, duration: 4, workingStart: 8, uuid: "m2" }),
    ];
    const data = deriveActivityData({ events });

    // The failed tool's marker (at its completion) is inside turn 1.
    expect(turnAt(data.turns, kRunStart + 8)?.index).toBe(1);
    // The compaction at 9s falls between turns: no containing turn, snaps
    // to turn 2 as a marker — but as a drop it belongs to turn 1, the
    // call it compacted.
    expect(turnAt(data.turns, kRunStart + 9)).toBeUndefined();
    expect(turnAfter(data.turns, kRunStart + 9)?.index).toBe(2);
    expect(data.compactions.map((drop) => drop.turn)).toEqual([1]);
    expect(turnAfter(data.turns, kRunStart + 20)).toBeUndefined();
  });

  it("counts a rejected call on the conversation's current turn", () => {
    const events: Event[] = [
      modelCall({ start: 0, duration: 4, workingStart: 0, uuid: "m1" }),
      testApprovalEvent({
        timestamp: iso(5),
        decision: "reject",
        approver: "human",
      }),
      modelCall({ start: 8, duration: 4, workingStart: 4, uuid: "m2" }),
    ];
    const data = deriveActivityData({ events });
    expect(data.turns[0]).toMatchObject({ rejected: 1, end: kRunStart + 5 });
    expect(data.turns[1]).toMatchObject({ rejected: 0 });
  });

  it("stops a hand-off tool's working share where the child starts", () => {
    const react = {
      begin: testSpanBeginEvent({
        id: "react",
        name: "react",
        type: "agent",
        timestamp: iso(0),
        working_start: 0,
      }),
      end: testSpanEndEvent({
        id: "react",
        timestamp: iso(40),
        working_start: 40,
      }),
    };
    const tool = testSpanBeginEvent({
      id: "tool",
      name: "transfer",
      type: "tool",
      parent_id: "react",
      timestamp: iso(6),
      working_start: 6,
    });
    const child = {
      begin: testSpanBeginEvent({
        id: "child",
        name: "analyst",
        type: "agent",
        parent_id: "tool",
        timestamp: iso(8),
        working_start: 8,
      }),
      end: testSpanEndEvent({
        id: "child",
        timestamp: iso(26),
        working_start: 26,
      }),
    };
    const events: Event[] = [
      react.begin,
      modelCall({ start: 0, duration: 4, workingStart: 0, spanId: "react" }),
      testToolEvent({
        timestamp: iso(4),
        completed: iso(26),
        working_start: 4,
        working_time: 22,
        function: "transfer",
        span_id: "react",
      }),
      tool,
      child.begin,
      modelCall({ start: 8, duration: 18, workingStart: 8, spanId: "child" }),
      child.end,
      testSpanEndEvent({ id: "tool", timestamp: iso(26), working_start: 26 }),
      react.end,
    ];
    const data = deriveActivityData({ events });
    const parentTurn = data.turns.find((turn) => turn.rowId === "react");
    // 22s of tool wall time, but the child ran from 8s → only 4s is the
    // parent's own hand-off work.
    expect(parentTurn?.toolWork).toBe(4);
    expect(parentTurn?.modelWork).toBe(4);
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
        approver: "human",
        decision: "reject",
        explanation: "destructive — narrow the path",
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
    // By column: rejections carry the approver, inputs the user.
    expect(data.rows.find((r) => r.category === "approval")?.by).toBe("human");
    expect(data.rows.find((r) => r.category === "input")?.by).toBe("user");
  });

  it("renders only non-approve decisions, captioned by the decision word", () => {
    // With an approval policy active every tool call produces an
    // ApprovalEvent — approve decisions are pure noise and never render.
    const events: Event[] = [
      testApprovalEvent({
        timestamp: iso(1),
        decision: "approve",
        approver: "auto",
        uuid: "ok",
      }),
      testApprovalEvent({
        timestamp: iso(2),
        decision: "reject",
        approver: "human",
        explanation: "destructive — narrow the path",
        call: testToolCall({
          function: "bash",
          arguments: { cmd: "rm -rf build/" },
        }),
        uuid: "rej",
      }),
      testApprovalEvent({
        timestamp: iso(3),
        decision: "escalate",
        approver: "auto",
        uuid: "esc",
      }),
      testApprovalEvent({
        timestamp: iso(4),
        decision: "terminate",
        approver: "human",
        uuid: "term",
      }),
      testApprovalEvent({
        timestamp: iso(5),
        decision: "modify",
        approver: "human",
        uuid: "mod",
      }),
    ];
    const data = deriveActivityData({ events });

    expect(data.markers.map((m) => m.key)).toEqual([
      "rej",
      "esc",
      "term",
      "mod",
    ]);
    expect(data.rows.find((r) => r.key === "ok")).toBeUndefined();
    expect(data.rejectedCount).toBe(4);
    expect(data.rows.map((r) => rowKind(r))).toEqual([
      "rejected",
      "escalated",
      "terminated",
      "modified",
    ]);

    const rejected = data.rows[0]!;
    expect(rejected).toMatchObject({
      lead: "Tool call",
      mono: "bash: rm -rf build/",
      tail: "rejected",
      detail: "“destructive — narrow the path”",
      by: "human",
      byRole: "approver",
    });
    expect(data.markers[0]?.label).toBe("Tool call bash rejected");
    // The filter pill reads Rejections; the row's kind is searchable.
    expect(kCategoryLong.approval).toBe("Rejections");
    expect(rowHaystack(rejected)).toContain("rejected");
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
        decision: "reject",
      }),
    ];
    const data = deriveActivityData({ events });
    const haystack = rowHaystack(data.rows[0]!).toLowerCase();
    expect(haystack).toContain("rejections");
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

describe("numeric telemetry bounds (review round 2)", () => {
  const usageOf = (input: number, output = 0) =>
    testModelOutput({
      usage: testModelUsage({
        input_tokens: input,
        output_tokens: output,
        total_tokens: input + output,
      }),
    });

  it("treats overflowing or non-finite token counts as missing usage", () => {
    // Two 1e308 usages pass the normalizer's typeof checks but sum to
    // Infinity; Infinity/NaN can also arrive directly.
    const events = normalizeEvents([
      testModelEvent({
        timestamp: iso(0),
        completed: iso(1),
        uuid: "a",
        output: usageOf(1e308),
      }),
      testModelEvent({
        timestamp: iso(2),
        completed: iso(3),
        uuid: "b",
        output: usageOf(1e308),
      }),
      testModelEvent({
        timestamp: iso(4),
        completed: iso(5),
        uuid: "c",
        output: usageOf(Infinity),
      }),
      testModelEvent({
        timestamp: iso(6),
        completed: iso(7),
        uuid: "d",
        output: usageOf(NaN),
      }),
      testModelEvent({
        timestamp: iso(8),
        completed: iso(9),
        uuid: "e",
        output: usageOf(100, Infinity),
      }),
      testModelEvent({
        timestamp: iso(10),
        completed: iso(11),
        uuid: "f",
        output: usageOf(100),
      }),
    ]);
    const data = deriveActivityData({ events });

    expect(data.totalTokens).toBe(100);
    expect(data.tokenPoints.map((p) => p.uuid)).toEqual(["f"]);
    expect(data.contextSeries.map((p) => p.uuid)).toEqual(["f"]);
    expect(data.contextPeak).toBe(100);
    // The model spans still render; only their token detail is absent.
    expect(data.agentRows[0]?.spans).toHaveLength(6);
    const corrupt = data.agentRows[0]?.spans.find((s) => s.uuid === "e");
    expect(corrupt?.inputTokens).toBeUndefined();
    expect(corrupt?.outputTokens).toBeUndefined();
    for (const value of [
      ...data.tokenSeries.map((p) => p.value),
      ...data.contextSeries.map((p) => p.value),
      data.totalTokens,
      data.contextPeak,
    ]) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it("drops non-finite compaction counts and working time", () => {
    const events = normalizeEvents([
      testModelEvent({
        timestamp: iso(0),
        completed: iso(1),
        working_start: 0,
        working_time: Infinity,
        output: usageOf(100),
      }),
      testCompactionEvent({
        timestamp: iso(2),
        tokens_before: Infinity,
        tokens_after: NaN,
      }),
    ]);
    const data = deriveActivityData({ events });

    // before falls back to the last context; after is simply unknown.
    expect(data.compactions[0]).toMatchObject({ before: 100 });
    expect(data.compactions[0]?.after).toBeUndefined();
    expect(Number.isFinite(data.agentRows[0]?.spans[0]?.working)).toBe(true);
  });
});

describe("approval decisions (review round 2)", () => {
  it("captions unknown and prototype-named decisions with a plain string", () => {
    // The decision enum is not validated at parse time. A crafted
    // "__proto__" must not resolve to Object.prototype through a plain
    // object lookup; a future decision word keeps its own caption.
    const events = normalizeEvents([
      {
        ...testApprovalEvent({ timestamp: iso(1), uuid: "p" }),
        decision: "__proto__",
      },
      {
        ...testApprovalEvent({ timestamp: iso(2), uuid: "c" }),
        decision: "constructor",
      },
      {
        ...testApprovalEvent({ timestamp: iso(3), uuid: "f" }),
        decision: "future-decision",
      },
      { ...testApprovalEvent({ timestamp: iso(4), uuid: "n" }), decision: 7 },
    ]);
    const data = deriveActivityData({ events });

    expect(data.rows.map((r) => r.kind)).toEqual([
      "__proto__",
      "constructor",
      "future-decision",
      "decided",
    ]);
    for (const row of data.rows) expect(typeof rowKind(row)).toBe("string");
    expect(data.markers[2]?.label).toBe("Tool call test_tool future-decision");
    expect(data.rejectedCount).toBe(4);
  });
});

describe("out-of-order events (review round 2)", () => {
  it("attaches a late-arriving tool to the turn that issued it, not a later one", () => {
    // The tool ran at t=2–3 (inside turn 1) but its event lands after the
    // t=20 model call in the array.
    const events: Event[] = [
      modelCall({ start: 0, duration: 1, workingStart: 0, uuid: "m1" }),
      modelCall({ start: 20, duration: 1, workingStart: 20, uuid: "m2" }),
      testToolEvent({
        uuid: "tool-for-first",
        timestamp: iso(2),
        completed: iso(3),
        working_start: 2,
      }),
    ];
    const data = deriveActivityData({ events });

    expect(data.turns[0]?.tools.map((t) => t.uuid)).toEqual(["tool-for-first"]);
    expect(data.turns[1]?.tools).toHaveLength(0);
    expect(data.turns[0]?.tools[0]?.turn).toBe(1);
    for (const turn of data.turns) {
      for (const tool of turn.tools) {
        expect(tool.start).toBeGreaterThanOrEqual(turn.start);
      }
    }
  });

  it("keeps synthetic history keys on the original array index", () => {
    const events: Event[] = [
      testErrorEvent({ timestamp: iso(5), uuid: null }),
      testErrorEvent({ timestamp: iso(1), uuid: null }),
    ];
    const data = deriveActivityData({ events });
    expect(data.rows.map((r) => r.key)).toEqual(["evt:1", "evt:0"]);
  });

  it("resolves role attribution and the compaction fallback in timestamp order", () => {
    // Array order: compaction, tool, grader model, root model. Timestamp
    // order: root model → grader model (300 in context) → tool → compaction
    // without tokens_before. The tool belongs to the grader (the latest
    // model at its time) and the compaction falls back to the grader's
    // context; in array order both would run before any model call.
    const events: Event[] = [
      testCompactionEvent({
        timestamp: iso(30),
        working_start: 30,
        tokens_after: 20,
        uuid: "c",
      }),
      testToolEvent({
        uuid: "t",
        timestamp: iso(20),
        completed: iso(21),
        working_start: 20,
      }),
      modelCall({
        start: 10,
        duration: 1,
        workingStart: 10,
        role: "grader",
        input: 300,
        uuid: "g",
      }),
      modelCall({
        start: 0,
        duration: 1,
        workingStart: 0,
        input: 100,
        uuid: "m",
      }),
    ];
    const data = deriveActivityData({ events });

    const grader = data.agentRows.find((row) => row.role === "grader");
    expect(grader?.spans.map((s) => s.uuid)).toEqual(["g", "t"]);
    expect(data.compactions[0]?.rowId).toBe("role:grader");
    expect(data.compactions[0]?.before).toBe(300);
    expect(data.compactions[0]?.after).toBe(20);
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

describe("sentinel decisions", () => {
  const kAgent = "agent";
  const agentBegin = testSpanBeginEvent({
    id: kAgent,
    name: "react",
    type: "agent",
    timestamp: iso(0),
  });

  /** A model turn on the agent that proposes one bash call. */
  const proposes = (
    start: number,
    callId: string,
    cmd: string,
    uuid = `m-${callId}`,
    spanId = kAgent
  ): ModelEvent => {
    const event = modelCall({
      start,
      duration: 1,
      workingStart: start,
      uuid,
      spanId,
    });
    const call = testToolCall({
      id: callId,
      function: "bash",
      arguments: { cmd },
    });
    return {
      ...event,
      output: {
        ...event.output,
        choices: [
          testChatCompletionChoice({
            message: testAssistantMessage({ tool_calls: [call] }),
            stop_reason: "tool_calls",
          }),
        ],
      },
    };
  };

  /** The span a step's events record in, under the agent. */
  const sentinelSpan = (id: string, at: number) =>
    testSpanBeginEvent({
      id,
      name: "sentinel",
      type: "sentinel",
      parent_id: kAgent,
      timestamp: iso(at),
    });

  /** One check's decision on `stepId`, at `path` ("" is the root). */
  const check = (
    span: string,
    at: number,
    stepId: string,
    path: string,
    action: NonNullable<SentinelEvent["action"]>,
    overrides: Partial<SentinelEvent> = {}
  ): SentinelEvent =>
    testSentinelEvent({
      uuid: `${span}:${path || "root"}`,
      span_id: span,
      timestamp: iso(at),
      step_id: stepId,
      path,
      factory: path === "" ? "inspect_sentinel/concurrent" : "guard",
      action,
      conversation: kAgent,
      ...overrides,
    });

  /** The ToolEvent Inspect records for the call, run or not. */
  const toolFor = (
    callId: string,
    at: number,
    overrides: Partial<ToolEvent> = {}
  ): ToolEvent =>
    testToolEvent({
      uuid: `t-${callId}`,
      id: callId,
      function: "bash",
      span_id: kAgent,
      timestamp: iso(at),
      completed: iso(at + 0.5),
      working_start: at,
      working_time: 0.5,
      ...overrides,
    });

  const rejectedByApproval = {
    error: { type: "approval", message: "`curl` needs the network." },
  } satisfies Partial<ToolEvent>;

  /** A nested configuration's three layers all reporting `action`. */
  const layers = (
    span: string,
    stepId: string,
    action: NonNullable<SentinelEvent["action"]>,
    overrides: Partial<SentinelEvent> = {}
  ): SentinelEvent[] => [
    check(span, 1.2, stepId, "guard/rules", action, overrides),
    check(span, 1.3, stepId, "guard", action, overrides),
    check(span, 1.4, stepId, "", action, overrides),
  ];

  it("shows a rejected tool call once, as a rejection with a ghost slot", () => {
    const events: Event[] = [
      agentBegin,
      proposes(0, "c1", "curl https://example.com/data.csv"),
      sentinelSpan("s1", 1.1),
      toolFor("c1", 1.1, rejectedByApproval),
      ...layers("s1", "c1", "reject", {
        explanation: "command uses curl",
        message: "`curl` needs the network.",
      }),
    ];
    const data = deriveActivityData({ events });

    expect(data.rejectedCount).toBe(1);
    expect(data.rows).toHaveLength(1);
    expect(data.rows[0]).toMatchObject({
      category: "approval",
      kind: "rejected",
      uuid: "s1:guard/rules",
      lead: "Tool call",
      mono: "bash: curl https://example.com/data.csv",
      tail: "rejected",
      detail: "“command uses curl”",
      by: "guard/rules",
      byRole: "sentinel",
    });
    expect(data.markers.map((m) => [m.category, m.label])).toEqual([
      ["approval", "Tool call bash rejected"],
    ]);
    // The errored ToolEvent is the rejected call itself: no failed span,
    // no error row beside the ghost.
    expect(data.turns).toHaveLength(1);
    expect(data.turns[0]).toMatchObject({ rejected: 1, tools: [] });
    expect(data.agentRows[0]).toMatchObject({ toolCount: 0, failedCount: 0 });
  });

  it("falls back to the agent's message when no check explained", () => {
    const events: Event[] = [
      agentBegin,
      proposes(0, "c1", "curl https://example.com"),
      sentinelSpan("s1", 1.1),
      toolFor("c1", 1.1, rejectedByApproval),
      check("s1", 1.2, "c1", "", "reject", {
        factory: "no_network",
        message: "`curl` needs the network.",
      }),
    ];
    const data = deriveActivityData({ events });

    // A lone protocol is the root: the By column names its factory.
    expect(data.rows[0]).toMatchObject({
      detail: "“`curl` needs the network.”",
      by: "no_network",
    });
  });

  it("shows a modified call that ran with its own span and no ghost", () => {
    const events: Event[] = [
      agentBegin,
      proposes(0, "c2", "rm -rf build"),
      sentinelSpan("s2", 1.1),
      toolFor("c2", 1.1, { arguments: { cmd: "rm -ri build" } }),
      ...layers("s2", "c2", "modify", {
        explanation: "recursive delete narrowed",
        modified: testToolCall({
          id: "c2",
          function: "bash",
          arguments: { cmd: "rm -ri build" },
        }),
      }),
    ];
    const data = deriveActivityData({ events });

    expect(data.rejectedCount).toBe(1);
    // The row names the call as the model proposed it, like an approval's.
    expect(data.rows.map((r) => [rowKind(r), r.mono])).toEqual([
      ["modified", "bash: rm -rf build"],
    ]);
    expect(data.turns[0]?.rejected).toBe(0);
    expect(data.turns[0]?.tools.map((t) => t.uuid)).toEqual(["t-c2"]);
  });

  it("shows a terminated call as a ghost, not a failed tool", () => {
    const events: Event[] = [
      agentBegin,
      proposes(0, "c3", "cat /etc/shadow"),
      sentinelSpan("s3", 1.1),
      toolFor("c3", 1.1, { failed: true }),
      ...layers("s3", "c3", "terminate", { explanation: "reads /etc/shadow" }),
    ];
    const data = deriveActivityData({ events });

    expect(data.rejectedCount).toBe(1);
    expect(data.rows.map((r) => [r.category, rowKind(r)])).toEqual([
      ["approval", "terminated"],
    ]);
    expect(data.markers[0]?.label).toBe("Tool call bash terminated");
    expect(data.turns[0]).toMatchObject({ rejected: 1, tools: [] });
  });

  it("captions an escalation that reached the root as escalated", () => {
    // Nothing above the root takes an escalate, so it took effect (the
    // runner ends the sample); it reads like an escalated approval.
    const events: Event[] = [
      agentBegin,
      proposes(0, "c4", "rm notes.txt"),
      sentinelSpan("s4", 1.1),
      toolFor("c4", 1.1, { failed: true }),
      check("s4", 1.2, "c4", "", "escalate", {
        factory: "triage",
        explanation: "call deletes files",
      }),
    ];
    const data = deriveActivityData({ events });

    expect(data.rejectedCount).toBe(1);
    expect(data.rows[0]).toMatchObject({ kind: "escalated", by: "triage" });
    expect(data.turns[0]?.rejected).toBe(1);
  });

  it("does not count an inner reject that the root overrode", () => {
    const events: Event[] = [
      agentBegin,
      proposes(0, "c1", "curl https://example.com"),
      sentinelSpan("s1", 1.1),
      toolFor("c1", 1.1),
      check("s1", 1.2, "c1", "guard/rules", "reject"),
      check("s1", 1.3, "c1", "guard/rules", "reject", {
        uuid: "s1:superseded",
        status: "superseded",
      }),
      check("s1", 1.4, "c1", "", "proceed"),
    ];
    const data = deriveActivityData({ events });

    expect(data.rejectedCount).toBe(0);
    expect(data.rows).toEqual([]);
    expect(data.markers).toEqual([]);
    expect(data.turns[0]).toMatchObject({ rejected: 0 });
    expect(data.turns[0]?.tools.map((t) => t.uuid)).toEqual(["t-c1"]);
  });

  it("counts a step once when an outer layer rejects what an inner proceeded", () => {
    const events: Event[] = [
      agentBegin,
      proposes(0, "c1", "curl https://example.com"),
      sentinelSpan("s1", 1.1),
      toolFor("c1", 1.1, rejectedByApproval),
      check("s1", 1.2, "c1", "guard/rules", "proceed"),
      check("s1", 1.3, "c1", "guard", "reject", {
        explanation: "rules disagree",
      }),
      check("s1", 1.4, "c1", "", "reject", {
        explanation: "rules disagree",
      }),
    ];
    const data = deriveActivityData({ events });

    expect(data.rejectedCount).toBe(1);
    expect(data.rows.map((r) => [rowKind(r), r.by])).toEqual([
      ["rejected", "guard"],
    ]);
    expect(data.turns[0]?.rejected).toBe(1);
  });

  it("does not count a step where monitors only observed", () => {
    const events: Event[] = [
      agentBegin,
      proposes(0, "c1", "ls"),
      sentinelSpan("s1", 1.1),
      toolFor("c1", 1.1),
      check("s1", 1.2, "c1", "suspicion", "proceed", {
        kind: "observation",
        action: null,
        suspicion: 0.9,
      }),
    ];
    const data = deriveActivityData({ events });

    expect(data.rejectedCount).toBe(0);
    expect(data.rows).toEqual([]);
    expect(data.turns[0]?.rejected).toBe(0);
  });

  it("shows a model_output decision by its stage, without a ghost", () => {
    const events: Event[] = [
      agentBegin,
      modelCall({ start: 0, duration: 1, workingStart: 0, spanId: kAgent }),
      sentinelSpan("s1", 1.1),
      check("s1", 1.2, "msg-1", "leak_check", "terminate", {
        stage: "model_output",
        factory: "leak_check",
        explanation: "output leaks the token",
      }),
      check("s1", 1.3, "msg-1", "", "terminate", {
        stage: "model_output",
        explanation: "output leaks the token",
      }),
    ];
    const data = deriveActivityData({ events });

    expect(data.rejectedCount).toBe(1);
    expect(data.rows).toHaveLength(1);
    expect(data.rows[0]).toMatchObject({
      lead: "Model output",
      mono: undefined,
      tail: "terminated",
      detail: "“output leaks the token”",
      by: "leak_check",
      byRole: "sentinel",
    });
    expect(data.markers[0]?.label).toBe("Model output terminated");
    // The model call ran; there is no unrun tool call to stand in for.
    expect(data.turns[0]).toMatchObject({ rejected: 0, end: kRunStart + 1.3 });
  });

  it.each([
    ["tool_call", "with a role", "monitor", 1],
    ["tool_call", "without a role", undefined, 1],
    ["model_output", "with a role", "monitor", 0],
    ["model_output", "without a role", undefined, 0],
  ] as const)(
    "places a %s decision on the turn that produced it, past a monitor %s",
    (stage, _, role, ghosts) => {
      // A role-keyed monitor call would claim the sentinel span's key for
      // its own row; a role-less one opens a turn on the agent's row.
      const events: Event[] = [
        agentBegin,
        proposes(0, "c1", "curl https://example.com"),
        sentinelSpan("s1", 1.1),
        modelCall({
          start: 1.2,
          duration: 0.5,
          workingStart: 1.2,
          role,
          spanId: "s1",
          uuid: "monitor",
        }),
        check(
          "s1",
          1.8,
          "c1",
          "",
          stage === "tool_call" ? "reject" : "terminate",
          {
            stage,
          }
        ),
        // A terminated output ends the sample before any tool runs.
        ...(stage === "tool_call"
          ? [toolFor("c1", 1.9, rejectedByApproval)]
          : []),
      ];
      const data = deriveActivityData({ events });

      expect(
        data.turns.map((turn) => [turn.model?.uuid, turn.rejected, turn.end])
      ).toEqual([
        ["m-c1", ghosts, kRunStart + 1.8],
        ["monitor", 0, kRunStart + 1.7],
      ]);
    }
  );

  it("keeps an earlier call's approval and failure rows when a sentinel rejects a later call with its id", () => {
    const events: Event[] = [
      agentBegin,
      proposes(0, "c1", "rm -rf /", "m-1"),
      testApprovalEvent({
        timestamp: iso(1.05),
        span_id: kAgent,
        decision: "reject",
        approver: "human",
        call: testToolCall({
          id: "c1",
          function: "bash",
          arguments: { cmd: "rm -rf /" },
        }),
      }),
      toolFor("c1", 1.1, { ...rejectedByApproval, uuid: "t-1" }),
      proposes(2, "c1", "cat missing.txt", "m-2"),
      toolFor("c1", 3.1, {
        uuid: "t-2",
        error: { type: "file_not_found", message: "missing.txt" },
      }),
      proposes(4, "c1", "curl https://example.com", "m-3"),
      sentinelSpan("s3", 5.1),
      check("s3", 5.2, "c1", "", "reject", { factory: "no_network" }),
      toolFor("c1", 5.3, {
        ...rejectedByApproval,
        uuid: "t-3",
        arguments: { cmd: "curl https://example.com" },
      }),
    ];
    const data = deriveActivityData({ events });

    expect(data.rejectedCount).toBe(2);
    expect(data.rows.map((r) => [rowKind(r), r.mono, r.by])).toEqual([
      ["rejected", "bash: rm -rf /", "human"],
      ["error", "bash", "system"],
      ["error", "bash", "system"],
      ["rejected", "bash: curl https://example.com", "no_network"],
    ]);
    expect(
      data.turns.map((turn) => [
        turn.model?.uuid,
        turn.rejected,
        turn.tools.map((tool) => tool.uuid),
      ])
    ).toEqual([
      ["m-1", 1, ["t-1"]],
      ["m-2", 0, ["t-2"]],
      ["m-3", 1, []],
    ]);
  });

  it("shows the arguments of the call a sentinel rejected when a later call reuses its id", () => {
    const events: Event[] = [
      agentBegin,
      proposes(0, "c1", "curl https://example.com", "m-1"),
      sentinelSpan("s1", 1.1),
      check("s1", 1.2, "c1", "", "reject", { factory: "no_network" }),
      toolFor("c1", 1.3, {
        ...rejectedByApproval,
        uuid: "t-1",
        arguments: { cmd: "curl https://example.com" },
      }),
      proposes(2, "c1", "ls", "m-2"),
      sentinelSpan("s2", 3.1),
      check("s2", 3.2, "c1", "", "proceed"),
      toolFor("c1", 3.3, { uuid: "t-2" }),
    ];
    const data = deriveActivityData({ events });

    expect(data.rows.map((r) => r.mono)).toEqual([
      "bash: curl https://example.com",
    ]);
    expect(
      data.turns.map((turn) => [
        turn.rejected,
        turn.tools.map((tool) => tool.uuid),
      ])
    ).toEqual([
      [1, []],
      [0, ["t-2"]],
    ]);
  });

  /** One model turn proposing two bash calls that share the id `c1`. */
  const proposesTwice = (first: string, second: string): ModelEvent => {
    const event = proposes(0, "c1", first);
    const calls = [first, second].map((cmd) =>
      testToolCall({ id: "c1", function: "bash", arguments: { cmd } })
    );
    return {
      ...event,
      output: {
        ...event.output,
        choices: [
          testChatCompletionChoice({
            message: testAssistantMessage({ tool_calls: calls }),
            stop_reason: "tool_calls",
          }),
        ],
      },
    };
  };

  it("pairs a sentinel with the call that reached it when its approval stopped an earlier one with the same id", () => {
    const approval = (
      at: number,
      decision: "approve" | "reject",
      cmd: string
    ) =>
      testApprovalEvent({
        timestamp: iso(at),
        span_id: kAgent,
        decision,
        approver: "human",
        call: testToolCall({ id: "c1", function: "bash", arguments: { cmd } }),
      });
    const events: Event[] = [
      agentBegin,
      proposesTwice("rm -rf /", "curl https://example.com"),
      approval(1.05, "reject", "rm -rf /"),
      toolFor("c1", 1.1, { ...rejectedByApproval, uuid: "t-1" }),
      approval(1.15, "approve", "curl https://example.com"),
      sentinelSpan("s1", 1.2),
      check("s1", 1.25, "c1", "", "reject", { factory: "no_network" }),
      toolFor("c1", 1.3, {
        ...rejectedByApproval,
        uuid: "t-2",
        arguments: { cmd: "curl https://example.com" },
      }),
    ];
    const data = deriveActivityData({ events });

    expect(data.rows.map((r) => [r.mono, r.by])).toEqual([
      ["bash: rm -rf /", "human"],
      ["bash: curl https://example.com", "no_network"],
      ["bash", "system"],
    ]);
    // The approval-stopped call keeps its failed span; the sentinel's is
    // the ghost.
    expect(data.turns[0]?.rejected).toBe(2);
    expect(data.turns[0]?.tools.map((tool) => tool.uuid)).toEqual(["t-1"]);
  });

  it("pairs a tool_result decision with the call that ran when an earlier one with the same id was stopped", () => {
    const events: Event[] = [
      agentBegin,
      proposesTwice("curl https://example.com", "cat notes.txt"),
      sentinelSpan("s1", 1.1),
      check("s1", 1.15, "c1", "", "reject", { factory: "no_network" }),
      toolFor("c1", 1.2, {
        ...rejectedByApproval,
        uuid: "t-1",
        arguments: { cmd: "curl https://example.com" },
      }),
      sentinelSpan("s2", 1.25),
      check("s2", 1.3, "c1", "", "proceed"),
      toolFor("c1", 1.35, { uuid: "t-2", arguments: { cmd: "cat notes.txt" } }),
      sentinelSpan("s3", 1.9),
      check("s3", 2, "c1", "", "terminate", {
        stage: "tool_result",
        factory: "leak_check",
      }),
    ];
    const data = deriveActivityData({ events });

    expect(data.rows.map((r) => [r.lead, r.mono, r.tail])).toEqual([
      ["Tool call", "bash: curl https://example.com", "rejected"],
      ["Tool result", "bash: cat notes.txt", "terminated"],
    ]);
    expect(data.turns[0]).toMatchObject({ rejected: 1 });
    expect(data.turns[0]?.tools.map((tool) => tool.uuid)).toEqual(["t-2"]);
  });

  it("skips a call whose arguments never parsed when pairing a tool_result decision", () => {
    const events: Event[] = [
      agentBegin,
      proposesTwice("cat {", "cat notes.txt"),
      toolFor("c1", 1.1, {
        uuid: "t-1",
        error: { type: "parsing", message: "Error parsing arguments" },
      }),
      toolFor("c1", 1.2, { uuid: "t-2", arguments: { cmd: "cat notes.txt" } }),
      sentinelSpan("s1", 1.9),
      check("s1", 2, "c1", "", "terminate", {
        stage: "tool_result",
        factory: "leak_check",
      }),
    ];
    const data = deriveActivityData({ events });

    expect(data.rows.map((r) => [r.lead, r.mono])).toEqual([
      ["Tool", "bash"],
      ["Tool result", "bash: cat notes.txt"],
    ]);
  });

  describe("steps recorded outside a sentinel span", () => {
    const kOther = "agent-b";
    /** A lone protocol's decision recorded in the agent's own span. */
    const spanless = (
      uuid: string,
      at: number,
      conversation: string,
      action: NonNullable<SentinelEvent["action"]>
    ): SentinelEvent =>
      testSentinelEvent({
        uuid,
        span_id: conversation,
        timestamp: iso(at),
        step_id: "c1",
        path: "",
        factory: "no_network",
        action,
        conversation,
      });

    it("keeps two agents' steps on a shared call id apart", () => {
      const events: Event[] = [
        agentBegin,
        testSpanBeginEvent({
          id: kOther,
          name: "helper",
          type: "agent",
          timestamp: iso(0),
        }),
        proposes(0, "c1", "curl https://example.com", "m-a"),
        proposes(0.2, "c1", "ls", "m-b", kOther),
        // Merged, the step would take agent-b's root as its outcome.
        spanless("b", 1.05, kOther, "proceed"),
        spanless("a", 1.1, kAgent, "reject"),
        toolFor("c1", 1.4, { ...rejectedByApproval, uuid: "t-a" }),
        toolFor("c1", 1.5, { uuid: "t-b", span_id: kOther }),
      ];
      const data = deriveActivityData({ events });

      expect(data.rejectedCount).toBe(1);
      expect(data.rows.map((r) => [r.uuid, r.mono])).toEqual([
        ["a", "bash: curl https://example.com"],
      ]);
      expect(
        data.turns.map((turn) => [
          turn.rowId,
          turn.rejected,
          turn.tools.map((tool) => tool.uuid),
        ])
      ).toEqual([
        [kAgent, 1, []],
        [kOther, 0, ["t-b"]],
      ]);
    });

    it("counts each turn's step when the agent reuses a call id", () => {
      const events: Event[] = [
        agentBegin,
        proposes(0, "c1", "curl https://example.com", "m-1"),
        spanless("s-1", 1.1, kAgent, "reject"),
        toolFor("c1", 1.2, {
          ...rejectedByApproval,
          uuid: "t-1",
          arguments: { cmd: "curl https://example.com" },
        }),
        proposes(2, "c1", "ls", "m-2"),
        spanless("s-2", 3.1, kAgent, "proceed"),
        toolFor("c1", 3.2, { uuid: "t-2" }),
        proposes(4, "c1", "wget https://example.com", "m-3"),
        spanless("s-3", 5.1, kAgent, "reject"),
        toolFor("c1", 5.2, {
          ...rejectedByApproval,
          uuid: "t-3",
          arguments: { cmd: "wget https://example.com" },
        }),
      ];
      const data = deriveActivityData({ events });

      expect(data.rows.map((r) => [r.uuid, r.mono])).toEqual([
        ["s-1", "bash: curl https://example.com"],
        ["s-3", "bash: wget https://example.com"],
      ]);
      expect(
        data.turns.map((turn) => [
          turn.rejected,
          turn.tools.map((tool) => tool.uuid),
        ])
      ).toEqual([
        [1, []],
        [0, ["t-2"]],
        [1, []],
      ]);
    });
  });

  it("does not count an action it does not know", () => {
    const raw = {
      ...check("s1", 1.2, "c1", "", "reject"),
      action: "audit",
    };
    const events: Event[] = [
      agentBegin,
      proposes(0, "c1", "ls"),
      sentinelSpan("s1", 1.1),
      ...normalizeEvents([raw]),
      toolFor("c1", 1.3),
    ];
    const data = deriveActivityData({ events });

    expect(data.rejectedCount).toBe(0);
    expect(data.rows).toEqual([]);
    expect(data.markers).toEqual([]);
    expect(data.turns[0]).toMatchObject({ rejected: 0 });
  });

  it("derives a normalized sentinel record that omits its path", () => {
    const raw: Record<string, unknown> = {
      ...check("s1", 1.2, "c1", "", "reject", { factory: "no_network" }),
    };
    delete raw.path;
    const events: Event[] = [
      agentBegin,
      proposes(0, "c1", "curl https://example.com"),
      sentinelSpan("s1", 1.1),
      ...normalizeEvents([raw]),
      toolFor("c1", 1.3, rejectedByApproval),
    ];
    const data = deriveActivityData({ events });

    // A record with no path reads as the root, like a lone protocol.
    expect(data.rows.map((r) => [rowKind(r), r.by])).toEqual([
      ["rejected", "no_network"],
    ]);
  });

  it("counts a call once when an approval and a sentinel both act on it", () => {
    const events: Event[] = [
      agentBegin,
      proposes(0, "c1", "curl -k https://example.com"),
      testApprovalEvent({
        timestamp: iso(1.05),
        span_id: kAgent,
        decision: "modify",
        approver: "human",
        call: testToolCall({
          id: "c1",
          function: "bash",
          arguments: { cmd: "curl -k https://example.com" },
        }),
      }),
      sentinelSpan("s1", 1.1),
      toolFor("c1", 1.1, rejectedByApproval),
      check("s1", 1.2, "c1", "", "reject", { factory: "no_network" }),
    ];
    const data = deriveActivityData({ events });

    expect(data.rejectedCount).toBe(1);
    expect(data.rows.map((r) => [rowKind(r), r.by])).toEqual([
      ["rejected", "no_network"],
    ]);
    expect(data.markers).toHaveLength(1);
    expect(data.turns[0]).toMatchObject({ rejected: 1, tools: [] });
  });

  it("leaves an approval-only rejection as it was: the failed tool stays beside it", () => {
    const events: Event[] = [
      agentBegin,
      proposes(0, "c1", "rm -rf /"),
      testApprovalEvent({
        timestamp: iso(1.05),
        span_id: kAgent,
        decision: "reject",
        approver: "human",
        call: testToolCall({ id: "c1", function: "bash" }),
      }),
      toolFor("c1", 1.1, rejectedByApproval),
    ];
    const data = deriveActivityData({ events });

    expect(data.rejectedCount).toBe(1);
    expect(data.rows.map((r) => [r.category, r.lead, r.tail])).toEqual([
      ["approval", "Tool call", "rejected"],
      ["error", "Tool", "errored"],
    ]);
    expect(data.markers.map((m) => m.category)).toEqual(["approval", "error"]);
    expect(data.turns[0]?.rejected).toBe(1);
    expect(
      data.turns[0]?.tools.map((tool) => [tool.uuid, tool.failed])
    ).toEqual([["t-c1", true]]);
    expect(data.agentRows[0]).toMatchObject({ toolCount: 1, failedCount: 1 });
  });

  it("pairs a tool_result decision with a call whose run failed", () => {
    const events: Event[] = [
      agentBegin,
      proposes(0, "c1", "cat /etc/shadow", "m-1"),
      sentinelSpan("s1", 1.1),
      check("s1", 1.15, "c1", "", "proceed"),
      toolFor("c1", 1.2, {
        error: { type: "permission", message: "Permission denied" },
      }),
      sentinelSpan("s2", 1.8),
      // A role-less monitor's call opens a turn; the decision still
      // belongs to the turn that proposed the call.
      modelCall({
        start: 1.85,
        duration: 0.1,
        workingStart: 1.85,
        spanId: "s2",
        uuid: "monitor",
      }),
      check("s2", 2, "c1", "", "terminate", {
        stage: "tool_result",
        factory: "leak_check",
      }),
    ];
    const data = deriveActivityData({ events });

    expect(data.rows.map((r) => [r.lead, r.mono, r.tail])).toEqual([
      ["Tool", "bash", "errored"],
      ["Tool result", "bash: cat /etc/shadow", "terminated"],
    ]);
    expect(data.turns.map((turn) => [turn.model?.uuid, turn.end])).toEqual([
      ["m-1", kRunStart + 2],
      ["monitor", kRunStart + 1.95],
    ]);
  });

  describe("an agent bridge's checks", () => {
    // Inspect records `execution_id` only for a run a bridge handed over
    // under a new id, so a sample pairs by execution only with one; this
    // auto-approval of such a run elsewhere pairs with no call and draws
    // no row.
    const handedOverElsewhere = testApprovalEvent({
      uuid: "elsewhere",
      timestamp: iso(0.01),
      span_id: kAgent,
      approver: "auto",
      decision: "approve",
      call: testToolCall({ id: "elsewhere", function: "bash" }),
      execution_id: "elsewhere-run",
    });
    const bridgeSpan = (id: string, at: number) =>
      testSpanBeginEvent({
        id,
        name: "sentinel_bridge",
        type: "sentinel",
        parent_id: kAgent,
        timestamp: iso(at),
      });
    const hostToolFor = (
      callId: string,
      at: number,
      overrides: Partial<ToolEvent> = {}
    ): ToolEvent =>
      toolFor(callId, at, {
        metadata: {
          bridge: {
            server: "host",
            tool: "bash",
            function: "mcp__host__bash",
            proposal_id: callId,
            grant: "consumed",
          },
        },
        ...overrides,
      });

    it("keeps a bridge's result check off a native call under the same id, which the native check keeps", () => {
      const events: Event[] = [
        agentBegin,
        proposes(0, "c1", "cat notes.txt"),
        toolFor("c1", 1.1),
        bridgeSpan("s1", 1.6),
        check("s1", 1.7, "c1", "", "reject", {
          stage: "tool_result",
          factory: "bridge_check",
        }),
        sentinelSpan("s2", 1.8),
        check("s2", 1.9, "c1", "", "terminate", {
          stage: "tool_result",
          factory: "leak_check",
        }),
      ];
      const data = deriveActivityData({ events });

      expect(data.rows.map((r) => [r.lead, r.mono, r.tail])).toEqual([
        ["Tool result", undefined, "rejected"],
        ["Tool result", "bash: cat notes.txt", "terminated"],
      ]);
    });

    it("pairs a bridge's call check with the host call it ran, past a native call under the same id", () => {
      const events: Event[] = [
        agentBegin,
        proposesTwice("cat notes.txt", "cat host.txt"),
        bridgeSpan("s1", 1.05),
        ...layers("s1", "c1", "reject", { explanation: "host read" }),
        toolFor("c1", 1.5, {
          uuid: "t-1",
          arguments: { cmd: "cat notes.txt" },
        }),
        hostToolFor("c1", 1.6, {
          uuid: "t-2",
          arguments: { cmd: "cat host.txt" },
          ...rejectedByApproval,
        }),
      ];
      const data = deriveActivityData({ events });

      expect(data.rows.map((r) => [r.lead, r.mono, r.tail])).toEqual([
        ["Tool call", "bash: cat host.txt", "rejected"],
      ]);
      expect(data.turns[0]).toMatchObject({ rejected: 1 });
      expect(data.turns[0]?.tools.map((tool) => tool.uuid)).toEqual(["t-1"]);
    });

    it("pairs a bridge's result check with the host call it ran, past a native call under the same id", () => {
      const events: Event[] = [
        agentBegin,
        proposesTwice("cat notes.txt", "cat host.txt"),
        toolFor("c1", 1.1, {
          uuid: "t-1",
          arguments: { cmd: "cat notes.txt" },
        }),
        hostToolFor("c1", 1.3, {
          uuid: "t-2",
          arguments: { cmd: "cat host.txt" },
        }),
        bridgeSpan("s1", 1.8),
        check("s1", 1.9, "c1", "", "terminate", {
          stage: "tool_result",
          factory: "leak_check",
        }),
      ];
      const data = deriveActivityData({ events });

      expect(data.rows.map((r) => [r.lead, r.mono, r.tail])).toEqual([
        ["Tool result", "bash: cat host.txt", "terminated"],
      ]);
    });

    it("keeps a native call check off a host call the bridge ran earlier under the same id", () => {
      const events: Event[] = [
        agentBegin,
        { ...proposes(0, "c1", "cat host.txt"), requested_model: "client" },
        bridgeSpan("s1", 1.05),
        check("s1", 1.1, "c1", "", "proceed", { factory: "bridge_check" }),
        hostToolFor("c1", 1.3, { uuid: "t-host" }),
        sentinelSpan("s2", 1.85),
        check("s2", 1.9, "c1", "", "reject", { factory: "native_check" }),
        toolFor("c1", 2, {
          uuid: "t-native",
          function: "native",
          arguments: { cmd: "native-cmd" },
          ...rejectedByApproval,
        }),
      ];
      const data = deriveActivityData({ events });

      expect(data.rows.map((r) => [r.lead, r.mono, r.tail])).toEqual([
        ["Tool call", "native: native-cmd", "rejected"],
      ]);
      expect(data.turns[0]?.tools.map((tool) => tool.uuid)).toEqual(["t-host"]);
    });

    it("keeps a host run under the model's id when a native run under that id follows it", () => {
      const events: Event[] = [
        agentBegin,
        handedOverElsewhere,
        proposes(0, "c1", "cat a.txt"),
        hostToolFor("c1", 1.1, {
          uuid: "t-host",
          arguments: { cmd: "cat host.txt" },
        }),
        toolFor("c1", 1.2, { uuid: "t-native" }),
        bridgeSpan("s1", 1.5),
        check("s1", 1.6, "c1", "", "terminate", {
          stage: "tool_result",
          factory: "bridge_check",
        }),
      ];
      const data = deriveActivityData({ events });

      expect(data.rows.map((r) => [r.lead, r.mono, r.tail])).toEqual([
        ["Tool result", "bash: cat a.txt", "terminated"],
      ]);
    });

    it("keeps a native call check that recorded before any tool off the host call that then ran first, and names it as it ran", () => {
      const events: Event[] = [
        agentBegin,
        handedOverElsewhere,
        proposesTwice("cat a.txt", "cat b.txt"),
        sentinelSpan("s1", 1),
        check("s1", 1.05, "c1", "", "modify", {
          factory: "native_check",
          modified: testToolCall({
            id: "c1",
            function: "bash",
            arguments: { cmd: "cat a.safe" },
          }),
        }),
        bridgeSpan("s2", 1.2),
        check("s2", 1.25, "c1", "", "proceed", { factory: "bridge_check" }),
        hostToolFor("c1", 2, {
          uuid: "t-host",
          arguments: { cmd: "cat b.txt" },
        }),
        toolFor("c1", 2.1, {
          uuid: "t-native",
          arguments: { cmd: "cat a.safe" },
        }),
      ];
      const data = deriveActivityData({ events });

      // Two calls were proposed under the id, so neither run's arguments
      // say which one the native run was.
      expect(data.rows.map((r) => [r.lead, r.mono, r.tail])).toEqual([
        ["Tool call", "bash: cat a.safe", "modified"],
      ]);
    });

    it("leaves a native call check unpaired, and its call unnamed, when only a host call ran under its id", () => {
      const events: Event[] = [
        agentBegin,
        handedOverElsewhere,
        proposesTwice("cat a.txt", "cat b.txt"),
        sentinelSpan("s1", 1),
        check("s1", 1.05, "c1", "", "reject", { factory: "native_check" }),
        hostToolFor("c1", 2, {
          uuid: "t-host",
          arguments: { cmd: "cat b.txt" },
        }),
      ];
      const data = deriveActivityData({ events });

      // The check never judged the host call; the host run's arguments do
      // not say which of the two proposals it was, so the other is unknown.
      expect(data.rows.map((r) => [r.lead, r.mono, r.tail])).toEqual([
        ["Tool call", undefined, "rejected"],
      ]);
      expect(data.turns[0]?.tools.map((tool) => tool.uuid)).toEqual(["t-host"]);
    });

    it("keeps a native result check off a host call the bridge ran earlier under the same id", () => {
      const events: Event[] = [
        agentBegin,
        proposesTwice("cat host.txt", "cat notes.txt"),
        hostToolFor("c1", 1.1, {
          uuid: "t-host",
          arguments: { cmd: "cat host.txt" },
        }),
        bridgeSpan("s1", 1.65),
        check("s1", 1.7, "c1", "", "terminate", {
          stage: "tool_result",
          factory: "bridge_check",
        }),
        toolFor("c1", 1.8, {
          uuid: "t-native",
          arguments: { cmd: "cat notes.txt" },
        }),
        sentinelSpan("s2", 2.35),
        check("s2", 2.4, "c1", "", "reject", {
          stage: "tool_result",
          factory: "native_check",
        }),
      ];
      const data = deriveActivityData({ events });

      expect(data.rows.map((r) => [r.lead, r.mono, r.tail])).toEqual([
        ["Tool result", "bash: cat host.txt", "terminated"],
        ["Tool result", "bash: cat notes.txt", "rejected"],
      ]);
    });

    /** A bridge's rejection of a call its scaffold would run itself, which
     *  records no ToolEvent. */
    const ownCallRejected = (proposal: ModelEvent): Event[] => [
      agentBegin,
      proposal,
      bridgeSpan("s1", 1.05),
      ...layers("s1", "tok1", "reject", { explanation: "uses curl" }),
    ];

    it("names an unpaired bridge call check from the bridge generation that proposed its id", () => {
      const data = deriveActivityData({
        events: ownCallRejected({
          ...proposes(0, "tok1", "curl https://example.com"),
          requested_model: "claude-sonnet-4-5",
        }),
      });

      expect(data.rows.map((r) => [r.lead, r.mono, r.tail])).toEqual([
        ["Tool call", "bash: curl https://example.com", "rejected"],
      ]);
    });

    it("counts an unpaired bridge call rejection on the bridge turn that proposed it, past a reviewer's call", () => {
      const events: Event[] = [
        agentBegin,
        {
          ...proposes(0, "tok1", "curl https://example.com"),
          requested_model: "client",
        },
        bridgeSpan("s1", 1.1),
        modelCall({
          start: 1.2,
          duration: 0.5,
          workingStart: 1.2,
          spanId: "s1",
          uuid: "reviewer",
        }),
        check("s1", 1.8, "tok1", "", "reject", { factory: "bridge_check" }),
      ];
      const data = deriveActivityData({ events });

      expect(data.rows.map((r) => [r.lead, r.mono, r.tail])).toEqual([
        ["Tool call", "bash: curl https://example.com", "rejected"],
      ]);
      expect(
        data.turns.map((turn) => [turn.model?.uuid, turn.rejected, turn.end])
      ).toEqual([
        ["m-tok1", 1, kRunStart + 1.8],
        ["reviewer", 0, kRunStart + 1.7],
      ]);
    });

    it("never names an unpaired bridge call check from a native proposal under its id", () => {
      const data = deriveActivityData({
        events: ownCallRejected(
          proposes(0, "tok1", "curl https://example.com")
        ),
      });

      expect(data.rows.map((r) => [r.lead, r.mono, r.tail])).toEqual([
        ["Tool call", undefined, "rejected"],
      ]);
    });

    describe("routed into a sub-agent", () => {
      // A model event sink's `on_start` can run a bridged generation in a
      // sub-agent's span; the bridge's check then records that conversation
      // while its span stays under the outer agent.
      const kSub = "sub";
      const subBegin = testSpanBeginEvent({
        id: kSub,
        name: "explorer",
        type: "agent",
        parent_id: kAgent,
        timestamp: iso(0.5),
      });
      const outerTurn = modelCall({
        start: 0,
        duration: 0.4,
        workingStart: 0,
        spanId: kAgent,
        uuid: "outer",
      });
      const bridgeGeneration = (callId: string, cmd: string): ModelEvent => ({
        ...proposes(1, callId, cmd, `m-${callId}`, kSub),
        requested_model: "client",
      });
      const turnEnds = (data: ReturnType<typeof deriveActivityData>) =>
        data.turns.map((turn) => [turn.model?.uuid, turn.end]);

      it("names the host call a sub-agent's bridge check modified and counts it on the sub-agent's turn", () => {
        const events: Event[] = [
          agentBegin,
          outerTurn,
          subBegin,
          bridgeGeneration("tok1", "cat secrets.txt"),
          bridgeSpan("s1", 2.1),
          check("s1", 2.2, "tok1", "", "modify", {
            factory: "bridge_check",
            conversation: kSub,
          }),
          hostToolFor("tok1", 2.3, { uuid: "t-host", span_id: kSub }),
        ];
        const data = deriveActivityData({ events });

        expect(data.rows.map((r) => [r.lead, r.mono, r.tail])).toEqual([
          ["Tool call", "bash: cat secrets.txt", "modified"],
        ]);
        expect(turnEnds(data)).toEqual([
          ["outer", kRunStart + 0.4],
          ["m-tok1", kRunStart + 2.8],
        ]);
      });

      it("names a sub-agent's own call its bridge check rejected and counts it on the sub-agent's turn", () => {
        const events: Event[] = [
          agentBegin,
          outerTurn,
          subBegin,
          bridgeGeneration("tok1", "curl https://example.com"),
          bridgeSpan("s1", 2.1),
          check("s1", 2.2, "tok1", "", "reject", {
            factory: "bridge_check",
            conversation: kSub,
          }),
        ];
        const data = deriveActivityData({ events });

        expect(data.rows.map((r) => [r.lead, r.mono, r.tail])).toEqual([
          ["Tool call", "bash: curl https://example.com", "rejected"],
        ]);
        expect(
          data.turns.map((turn) => [turn.model?.uuid, turn.rejected, turn.end])
        ).toEqual([
          ["outer", 0, kRunStart + 0.4],
          ["m-tok1", 1, kRunStart + 2.2],
        ]);
      });

      it("names the host call a sub-agent's bridge result check terminated", () => {
        const events: Event[] = [
          agentBegin,
          outerTurn,
          subBegin,
          bridgeGeneration("tok1", "cat secrets.txt"),
          hostToolFor("tok1", 2.1, { uuid: "t-host", span_id: kSub }),
          bridgeSpan("s1", 2.7),
          check("s1", 2.8, "tok1", "", "terminate", {
            stage: "tool_result",
            factory: "bridge_check",
            conversation: kSub,
          }),
        ];
        const data = deriveActivityData({ events });

        expect(data.rows.map((r) => [r.lead, r.mono, r.tail])).toEqual([
          ["Tool result", "bash: cat secrets.txt", "terminated"],
        ]);
        expect(turnEnds(data)).toEqual([
          ["outer", kRunStart + 0.4],
          ["m-tok1", kRunStart + 2.8],
        ]);
      });

      it("counts a sub-agent's bridge result check with no host call on the sub-agent's turn", () => {
        const events: Event[] = [
          agentBegin,
          outerTurn,
          subBegin,
          bridgeGeneration("tok1", "cat secrets.txt"),
          bridgeSpan("s1", 2.1),
          check("s1", 2.2, "tok1", "", "terminate", {
            stage: "tool_result",
            factory: "bridge_check",
            conversation: kSub,
          }),
        ];
        const data = deriveActivityData({ events });

        expect(data.rows.map((r) => [r.lead, r.mono, r.tail])).toEqual([
          ["Tool result", undefined, "terminated"],
        ]);
        expect(turnEnds(data)).toEqual([
          ["outer", kRunStart + 0.4],
          ["m-tok1", kRunStart + 2.2],
        ]);
      });

      it("pairs a bridge check whose recorded conversation is no span by its own span", () => {
        const events: Event[] = [
          agentBegin,
          proposes(0, "c1", "cat host.txt"),
          hostToolFor("c1", 1.1),
          bridgeSpan("s1", 1.7),
          check("s1", 1.8, "c1", "", "terminate", {
            stage: "tool_result",
            factory: "bridge_check",
            conversation: "sample-uuid",
          }),
        ];
        const data = deriveActivityData({ events });

        expect(data.rows.map((r) => [r.lead, r.mono, r.tail])).toEqual([
          ["Tool result", "bash: cat host.txt", "terminated"],
        ]);
      });
    });

    describe("a call handed over under a new id", () => {
      /** The bridge's approval of the call, by the run it names. */
      const approvalOf = (at: number, cmd: string, execution?: string): Event =>
        testApprovalEvent({
          uuid: `a-${execution ?? "c1"}`,
          timestamp: iso(at),
          span_id: kAgent,
          approver: "human",
          call: testToolCall({
            id: "c1",
            function: "bash",
            arguments: { cmd },
          }),
          execution_id: execution,
        });
      const handedTool = (id: string, at: number): ToolEvent =>
        hostToolFor(id, at, {
          uuid: `t-${id}`,
          metadata: {
            bridge: {
              server: "host",
              tool: "bash",
              function: "mcp__host__bash",
              proposal_id: "c1",
              grant: "consumed",
            },
          },
        });
      const resultCheck = (
        span: string,
        at: number,
        action: NonNullable<SentinelEvent["action"]>,
        execution?: string
      ): Event[] => [
        bridgeSpan(span, at),
        check(span, at + 0.05, "c1", "", action, {
          stage: "tool_result",
          factory: "bridge_check",
          execution_id: execution,
        }),
      ];
      const rows = (events: Event[]) =>
        deriveActivityData({ events }).rows.map((r) => [
          r.lead,
          r.mono,
          r.tail,
        ]);
      const ran = (id: string, at: number, cmd: string): ToolEvent => ({
        ...handedTool(id, at),
        arguments: { cmd },
      });
      const modify = (
        span: string,
        at: number,
        cmd: string,
        execution?: string
      ): Event[] => [
        bridgeSpan(span, at),
        check(span, at + 0.05, "c1", "", "modify", {
          factory: "bridge_check",
          execution_id: execution,
          modified: testToolCall({
            id: "c1",
            function: "bash",
            arguments: { cmd },
          }),
        }),
      ];

      it("names the call a run under the token checked from the output that proposed it again", () => {
        const events: Event[] = [
          agentBegin,
          {
            ...proposes(0, "c1", "cat a.txt", "m1"),
            requested_model: "client",
          },
          handedTool("c1", 1.1),
          ...resultCheck("s1", 1.6, "proceed"),
          {
            ...proposes(2, "c1", "cat b.txt", "m2"),
            requested_model: "client",
          },
          approvalOf(3, "cat b.txt", "tok"),
          handedTool("tok", 3.1),
          ...resultCheck("s2", 3.6, "terminate", "tok"),
        ];

        expect(rows(events)).toEqual([
          ["Tool result", "bash: cat b.txt", "terminated"],
        ]);
      });

      describe("run twice from one output", () => {
        const output = (): Event => ({
          ...proposesTwice("cat a.txt", "cat b.txt"),
          requested_model: "client",
        });
        const tools = {
          model: ran("c1", 1.3, "cat a.txt"),
          tok: ran("tok", 1.3, "cat b.txt"),
        };
        const results = {
          model: resultCheck("s-model", 1.6, "terminate"),
          tok: resultCheck("s-tok", 1.6, "reject", "tok"),
        };

        it.each([
          ["model's id", "model's id", ["model", "tok"], ["model", "tok"]],
          ["model's id", "token", ["model", "tok"], ["tok", "model"]],
          ["token", "model's id", ["tok", "model"], ["model", "tok"]],
          ["token", "token", ["tok", "model"], ["tok", "model"]],
        ] as const)(
          "names each result from its own run when the run under the %s starts first and the one under the %s completes first",
          (_started, _completed, starts, completions) => {
            const events: Event[] = [
              agentBegin,
              output(),
              approvalOf(1, "cat a.txt"),
              approvalOf(1.1, "cat b.txt", "tok"),
              ...starts.map((run) => tools[run]),
              ...completions.flatMap((run) => results[run]),
            ];

            const shown = rows(events);
            expect(shown).toHaveLength(2);
            expect(shown).toEqual(
              expect.arrayContaining([
                ["Tool result", "bash: cat a.txt", "terminated"],
                ["Tool result", "bash: cat b.txt", "rejected"],
              ])
            );
          }
        );
      });

      it("keeps a run under the token that starts first off the slot an approval of the run under the model's id holds", () => {
        const events: Event[] = [
          agentBegin,
          {
            ...proposesTwice("cat a.txt", "cat b.txt"),
            requested_model: "client",
          },
          approvalOf(1, "cat a.txt"),
          { ...handedTool("tok", 1.3), arguments: { cmd: "cat b.txt" } },
          ...resultCheck("s-tok", 1.6, "terminate", "tok"),
        ];

        expect(rows(events)).toEqual([
          ["Tool result", "bash: cat b.txt", "terminated"],
        ]);
      });

      describe("two distinct calls proposed under one id, with no approval policy", () => {
        const output = (): Event => ({
          ...proposesTwice("cat a.txt", "cat b.txt"),
          requested_model: "client",
        });

        it("names the result a check terminated from the run under the token that started first", () => {
          const events: Event[] = [
            agentBegin,
            output(),
            ran("tok", 1.3, "cat b.txt"),
            ...resultCheck("s-tok", 1.6, "terminate", "tok"),
          ];

          expect(rows(events)).toEqual([
            ["Tool result", "bash: cat b.txt", "terminated"],
          ]);
        });

        it("names each result from its own run when the run under the token starts first", () => {
          const events: Event[] = [
            agentBegin,
            output(),
            ran("tok", 1.3, "cat b.txt"),
            ran("c1", 1.4, "cat a.txt"),
            ...resultCheck("s-model", 1.6, "terminate"),
            ...resultCheck("s-tok", 1.7, "reject", "tok"),
          ];

          expect(rows(events)).toEqual([
            ["Tool result", "bash: cat a.txt", "terminated"],
            ["Tool result", "bash: cat b.txt", "rejected"],
          ]);
        });

        it("names each modified call from its own run, not from a proposal its records cannot tell apart", () => {
          const events: Event[] = [
            agentBegin,
            output(),
            ...modify("s-model", 1.05, "cat a.txt.safe"),
            ...modify("s-tok", 1.15, "cat b.txt.safe", "tok"),
            ran("tok", 1.3, "cat b.txt.safe"),
            ran("c1", 1.4, "cat a.txt.safe"),
          ];

          expect(rows(events)).toEqual([
            ["Tool call", "bash: cat a.txt.safe", "modified"],
            ["Tool call", "bash: cat b.txt.safe", "modified"],
          ]);
        });
      });

      describe("two outputs outstanding together under one id", () => {
        // As inspect_ai's bridge records them: after a warm-up call under
        // `c1`, two outputs each propose `c1` before the scaffold runs either,
        // a check modifies each, and the scaffold hands both back under
        // their tokens. No approval policy records the original calls.
        const output = (at: number, cmd: string, uuid: string): Event => ({
          ...proposes(at, "c1", cmd, uuid),
          requested_model: "client",
        });
        const outputs: Event[] = [
          agentBegin,
          output(0, "cat warm.txt", "m-warm"),
          ...modify("s-warm", 1, "cat warm.safe"),
          ran("c1", 1.2, "cat warm.safe"),
          output(2, "cat a.txt", "m-a"),
          ...modify("s-a", 3, "cat a.safe", "tok-a"),
          output(4, "cat b.txt", "m-b"),
        ];
        const checkB = modify("s-b", 5, "cat b.safe", "tok-b");
        const runs = {
          a: ran("tok-a", 6, "cat a.safe"),
          b: ran("tok-b", 6.1, "cat b.safe"),
        };

        it.each([
          ["in reverse order", ["b", "a"]],
          ["in order", ["a", "b"]],
        ] as const)(
          "names each modified call from its own run, not any output's proposal, when they run %s",
          (_order, order) => {
            const events = [
              ...outputs,
              ...checkB,
              ...order.map((run) => runs[run]),
            ];

            expect(rows(events)).toEqual([
              ["Tool call", "bash: cat warm.safe", "modified"],
              ["Tool call", "bash: cat a.safe", "modified"],
              ["Tool call", "bash: cat b.safe", "modified"],
            ]);
          }
        );

        it("names neither run from a proposal when a scaffold drops an undeclared argument from one and a check modifies the other", () => {
          // The bridge lets a scaffold drop bookkeeping arguments the served
          // tool does not declare, so A runs with B's proposed arguments.
          const proposing = (
            at: number,
            uuid: string,
            args: Record<string, string>
          ): ModelEvent => {
            const event = proposes(at, "c1", "", uuid);
            return {
              ...event,
              requested_model: "client",
              output: {
                ...event.output,
                choices: [
                  testChatCompletionChoice({
                    message: testAssistantMessage({
                      tool_calls: [
                        testToolCall({
                          id: "c1",
                          function: "mcp__host__bash",
                          arguments: args,
                        }),
                      ],
                    }),
                    stop_reason: "tool_calls",
                  }),
                ],
              },
            };
          };
          const events: Event[] = [
            agentBegin,
            proposing(0, "m-a", { cmd: "echo a", toolSummary: "A" }),
            bridgeSpan("s-a", 1),
            check("s-a", 1.05, "c1", "", "proceed", {
              factory: "bridge_check",
            }),
            proposing(2, "m-b", { cmd: "echo a" }),
            ...modify("s-b", 3, "safe", "tok-b"),
            ran("c1", 4, "echo a"),
            ran("tok-b", 6, "safe"),
            ...resultCheck("s-result", 7, "terminate", "tok-b"),
          ];
          const data = deriveActivityData({ events });

          expect(
            data.rows.map((r) => [r.lead, r.mono, r.tail, r.uuid])
          ).toEqual([
            ["Tool call", "bash: safe", "modified", "s-b:root"],
            ["Tool result", "bash: safe", "terminated", "s-result:root"],
          ]);
          // No record ties B's decisions to an output, so neither counts on
          // A's turn.
          expect(
            data.turns.map((turn) => [turn.model?.uuid, turn.rejected])
          ).toEqual([
            ["m-a", 0],
            ["m-b", 0],
          ]);
        });

        it("names only the call whose run's approval records it as proposed", () => {
          const events = [
            ...outputs,
            approvalOf(4.9, "cat b.txt", "tok-b"),
            ...checkB,
            runs.b,
            runs.a,
          ];

          expect(rows(events)).toEqual([
            ["Tool call", "bash: cat warm.safe", "modified"],
            ["Tool call", "bash: cat a.safe", "modified"],
            ["Tool call", "bash: cat b.txt", "modified"],
          ]);
        });
      });

      it("keeps a monitor's own approved call under the agent's id off the agent's call", () => {
        const events: Event[] = [
          agentBegin,
          handedOverElsewhere,
          proposes(0, "c1", "cat notes.txt"),
          testApprovalEvent({
            uuid: "a-agent",
            timestamp: iso(1),
            span_id: kAgent,
            approver: "human",
            call: testToolCall({
              id: "c1",
              function: "bash",
              arguments: { cmd: "cat notes.txt" },
            }),
          }),
          sentinelSpan("s1", 1.05),
          modelCall({
            start: 1.1,
            duration: 0.1,
            workingStart: 1.1,
            spanId: "s1",
            role: "monitor",
          }),
          testApprovalEvent({
            uuid: "a-monitor",
            timestamp: iso(1.25),
            span_id: "s1",
            approver: "human",
            call: testToolCall({ id: "c1", function: "lookup" }),
          }),
          toolFor("c1", 1.3, {
            uuid: "t-monitor",
            function: "lookup",
            span_id: "s1",
          }),
          check("s1", 1.9, "c1", "", "reject"),
          toolFor("c1", 2, { uuid: "t-agent", ...rejectedByApproval }),
        ];
        const data = deriveActivityData({ events });

        expect(data.rows.map((r) => [r.lead, r.mono, r.tail])).toEqual([
          ["Tool call", "bash: cat notes.txt", "rejected"],
        ]);
        expect(
          data.turns.flatMap((turn) => turn.tools.map((tool) => tool.uuid))
        ).not.toContain("t-agent");
      });
    });

    describe("calls of nested and sibling agents that share an id", () => {
      const call = (id: string, cmd: string, fn = "bash") =>
        testToolCall({ id, function: fn, arguments: { cmd } });
      /** A model turn in `span` proposing `calls`: a bridge generation's,
       *  unless `native`. */
      const output = (
        uuid: string,
        at: number,
        span: string,
        calls: ReturnType<typeof call>[],
        native = false
      ): ModelEvent => {
        const event = proposes(at, "unused", "", uuid, span);
        return {
          ...event,
          requested_model: native ? null : "client",
          output: {
            ...event.output,
            choices: [
              testChatCompletionChoice({
                message: testAssistantMessage({ tool_calls: calls }),
                stop_reason: "tool_calls",
              }),
            ],
          },
        };
      };
      /** A tool that runs the agent `child`, whose events are `events`. */
      const delegateTo = (
        child: string,
        at: number,
        events: Event[]
      ): Event[] => [
        testSpanBeginEvent({
          id: `${child}-tool`,
          name: "delegate",
          type: "tool",
          parent_id: kAgent,
          timestamp: iso(at),
        }),
        toolFor(`delegate-${child}`, at, {
          uuid: `t-${child}-delegate`,
          function: "delegate",
          span_id: `${child}-tool`,
        }),
        testSpanBeginEvent({
          id: child,
          name: child,
          type: "agent",
          parent_id: `${child}-tool`,
          timestamp: iso(at),
        }),
        ...events,
      ];
      /** A check's span in `parent`, as a bridge's or a native one. */
      const spanIn = (id: string, at: number, parent: string, bridge = true) =>
        testSpanBeginEvent({
          id,
          name: bridge ? "sentinel_bridge" : "sentinel",
          type: "sentinel",
          parent_id: parent,
          timestamp: iso(at),
        });
      const rows = (events: Event[]) =>
        deriveActivityData({ events }).rows.map((r) => [
          r.lead,
          r.mono,
          r.tail,
        ]);

      it("names a parent's modified run under a token from the parent's proposal when a delegated agent proposed the same id", () => {
        const events: Event[] = [
          agentBegin,
          output("m-first", 0, kAgent, [call("c0", "cat first.txt")]),
          hostToolFor("c0", 1.1, {
            uuid: "t-first",
            arguments: { cmd: "cat first.txt" },
          }),
          output("m-second", 2, kAgent, [
            call("delegate-child", "notes", "delegate"),
            call("c1", "cat parent.txt"),
          ]),
          spanIn("s-parent-call", 3.1, kAgent),
          check("s-parent-call", 3.15, "c1", "", "modify", {
            factory: "bridge_check",
            execution_id: "tok",
            modified: call("c1", "cat parent.safe"),
          }),
          ...delegateTo("child", 3.2, [
            output("m-child", 3.3, "child", [call("c1", "cat child.txt")]),
            spanIn("s-child-call", 4.4, "child"),
            check("s-child-call", 4.45, "c1", "", "reject", {
              factory: "bridge_check",
              conversation: "child",
            }),
            hostToolFor("c1", 4.5, {
              uuid: "t-child",
              span_id: "child",
              arguments: { cmd: "cat child.txt" },
              ...rejectedByApproval,
            }),
          ]),
          hostToolFor("tok", 5, {
            uuid: "t-parent",
            arguments: { cmd: "cat parent.safe" },
            metadata: {
              bridge: {
                server: "host",
                tool: "bash",
                function: "mcp__host__bash",
                proposal_id: "c1",
                grant: "consumed",
              },
            },
          }),
          spanIn("s-parent-result", 5.6, kAgent),
          check("s-parent-result", 5.65, "c1", "", "terminate", {
            stage: "tool_result",
            factory: "bridge_check",
            execution_id: "tok",
          }),
        ];

        expect(rows(events)).toEqual([
          ["Tool call", "bash: cat parent.txt", "modified"],
          ["Tool call", "bash: cat child.txt", "rejected"],
          ["Tool result", "bash: cat parent.txt", "terminated"],
        ]);
      });

      it("names each sibling agent's checked call from its own proposal when they run in parallel under a shared id", () => {
        // Both siblings' calls are recorded interleaved, the second sibling's
        // first.
        const nativeCheck = (
          sibling: string,
          at: number,
          action: NonNullable<SentinelEvent["action"]>
        ): Event[] => [
          spanIn(`s-${sibling}`, at, sibling, false),
          check(`s-${sibling}`, at + 0.05, "c1", "", action, {
            conversation: sibling,
          }),
        ];
        const events: Event[] = [
          agentBegin,
          output("m-parent", 0, kAgent, [
            call("delegate-a", "a", "delegate"),
            call("delegate-b", "b", "delegate"),
          ]),
          ...delegateTo("a", 1.1, []),
          ...delegateTo("b", 1.1, []),
          output("m-a", 1.2, "a", [call("c1", "cat a.txt")], true),
          output("m-b", 1.2, "b", [call("c1", "cat b.txt")], true),
          ...nativeCheck("b", 2.3, "modify"),
          ...nativeCheck("a", 2.4, "modify"),
          toolFor("c1", 2.5, {
            uuid: "t-b",
            span_id: "b",
            arguments: { cmd: "cat b.safe" },
          }),
          toolFor("c1", 2.6, {
            uuid: "t-a",
            span_id: "a",
            arguments: { cmd: "cat a.safe" },
          }),
        ];

        expect(rows(events)).toEqual([
          ["Tool call", "bash: cat b.txt", "modified"],
          ["Tool call", "bash: cat a.txt", "modified"],
        ]);
      });
    });

    describe("under a public subtask", () => {
      // `@subtask` opens a subtask span but leaves the agent span, which the
      // bridge's check records as its conversation, unchanged.
      const kTask = "task";
      const taskBegin = testSpanBeginEvent({
        id: kTask,
        name: "research",
        type: "subtask",
        parent_id: kAgent,
        timestamp: iso(0.5),
      });
      const subtaskEvent = testSubtaskEvent({
        span_id: kTask,
        timestamp: iso(0.6),
      });
      const outerTurn = modelCall({
        start: 0,
        duration: 0.4,
        workingStart: 0,
        spanId: kAgent,
        uuid: "outer",
      });
      const taskGeneration: ModelEvent = {
        ...proposes(1, "tok1", "cat blocked.txt", "m-task", kTask),
        requested_model: "client",
      };
      const taskCheck = (action: NonNullable<SentinelEvent["action"]>) => [
        { ...bridgeSpan("s1", 2.1), parent_id: kTask },
        check("s1", 2.2, "tok1", "", action, {
          factory: "bridge_check",
          conversation: kAgent,
        }),
      ];
      const turnSummary = (data: ReturnType<typeof deriveActivityData>) =>
        data.turns.map((turn) => [turn.model?.uuid, turn.rejected, turn.end]);

      it("names the subtask's rejected call and counts it on the subtask's turn", () => {
        const events: Event[] = [
          agentBegin,
          outerTurn,
          taskBegin,
          subtaskEvent,
          taskGeneration,
          ...taskCheck("reject"),
        ];
        const data = deriveActivityData({ events });

        expect(data.rows.map((r) => [r.lead, r.mono, r.tail])).toEqual([
          ["Tool call", "bash: cat blocked.txt", "rejected"],
        ]);
        expect(turnSummary(data)).toEqual([
          ["outer", 0, kRunStart + 0.4],
          ["m-task", 1, kRunStart + 2.2],
        ]);
      });

      it("names the subtask's host call its check modified and keeps it on the subtask's turn", () => {
        const events: Event[] = [
          agentBegin,
          outerTurn,
          taskBegin,
          subtaskEvent,
          taskGeneration,
          ...taskCheck("modify"),
          hostToolFor("tok1", 2.3, { uuid: "t-host", span_id: kTask }),
        ];
        const data = deriveActivityData({ events });

        expect(data.rows.map((r) => [r.lead, r.mono, r.tail])).toEqual([
          ["Tool call", "bash: cat blocked.txt", "modified"],
        ]);
        expect(turnSummary(data)).toEqual([
          ["outer", 0, kRunStart + 0.4],
          ["m-task", 0, kRunStart + 2.8],
        ]);
      });
    });

    it("counts a rejected attempt on that attempt's turn, not the retry's, without naming a call the retry's id also names", () => {
      // The bridge retries the generation without running the rejected
      // attempt's calls, and the retry can reuse the id.
      const retry: ModelEvent = {
        ...proposes(3, "tok1", "cat allowed.txt", "m-retry"),
        requested_model: "client",
      };
      const events: Event[] = [
        agentBegin,
        handedOverElsewhere,
        {
          ...proposes(0, "tok1", "cat blocked.txt"),
          requested_model: "client",
        },
        bridgeSpan("s1", 1.1),
        check("s1", 1.2, "tok1", "", "reject", { factory: "bridge_check" }),
        retry,
        bridgeSpan("s2", 4.1),
        check("s2", 4.2, "tok1", "", "proceed", { factory: "bridge_check" }),
        hostToolFor("tok1", 4.3, { uuid: "t-host" }),
      ];
      const data = deriveActivityData({ events });

      // The retry proposed another call under the id, and the rejected
      // attempt never ran, so no record of its own names its call.
      expect(data.rows.map((r) => [r.lead, r.mono, r.tail])).toEqual([
        ["Tool call", undefined, "rejected"],
      ]);
      expect(
        data.turns.map((turn) => [turn.model?.uuid, turn.rejected])
      ).toEqual([
        ["m-tok1", 1],
        ["m-retry", 0],
      ]);
    });
  });
});
