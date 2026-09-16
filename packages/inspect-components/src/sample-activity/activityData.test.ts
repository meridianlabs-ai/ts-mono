import { describe, expect, it } from "vitest";

import { normalizeEvents } from "@tsmono/inspect-common/normalize";
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
  testSpanBeginEvent,
  testSpanEndEvent,
  testToolCall,
  testToolEvent,
} from "@tsmono/inspect-common/testing";
import type { Event, ModelEvent } from "@tsmono/inspect-common/types";

import {
  deriveActivityData,
  fmtDurationWords,
  fmtTokens,
  hasEventTimestamps,
  kAgentHues,
  kCategoryLong,
  kScorerHue,
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
      {
        time: kRunStart,
        value: 1500,
        uuid: "m1",
        rowId: "root",
        messages: 0,
        turn: 1,
      },
      {
        time: kRunStart + 10,
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
