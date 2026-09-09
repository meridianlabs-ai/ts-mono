/**
 * Regression tests for the timeline dropping solver-level events when a solver
 * wraps an agent (e.g. as_solver): unwrapSolverSpan used to descend into the
 * inner agent span and discard sibling events in the parent solver, even of
 * types that were likely to be relevant (model, tool, score, info etc.).
 */
import { describe, expect, it } from "vitest";

import {
  testInfoEvent,
  testModelEvent,
  testModelOutput,
  testModelUsage,
  testScore,
  testScoreEvent,
  testSpanBeginEvent,
  testSpanEndEvent,
  testStateEvent,
} from "@tsmono/inspect-common/testing";
import type { Event } from "@tsmono/inspect-common/types";

import { buildTimeline, TimelineSpan, type Timeline } from "./core";

const BASE = new Date("2025-01-15T10:00:00Z").getTime();
const at = (sec: number) => new Date(BASE + sec * 1000).toISOString();

// --- raw event builders (inspect transcript schema) -------------------------
// NOTE FOR IMPLEMENTER: field names (id / parent_id / span_id / type) follow
// inspect's SpanBegin/SpanEnd/Event schema. If Step 5 fails to BUILD (rather
// than failing on the assertion), reconcile these against buildTimeline's
// solvers branch (~line 1717+ in core.ts) and @tsmono/inspect-common/types,
// then re-run. The test must fail because info/score are ABSENT, not because
// the fixture is malformed.
const spanBegin = (
  id: string,
  parent_id: string | null,
  name: string,
  type: string | null,
  sec: number
) => testSpanBeginEvent({ id, parent_id, name, type, timestamp: at(sec) });

const spanEnd = (id: string, sec: number) =>
  testSpanEndEvent({ id, timestamp: at(sec) });

const modelEvent = (span_id: string, sec: number) =>
  testModelEvent({
    span_id,
    timestamp: at(sec),
    completed: at(sec + 1),
    output: testModelOutput({
      usage: testModelUsage({
        input_tokens: 6,
        output_tokens: 4,
        total_tokens: 10,
      }),
    }),
  });

const infoEvent = (span_id: string, sec: number) =>
  testInfoEvent({ span_id, data: "solver-level info", timestamp: at(sec) });

const scoreEvent = (span_id: string, sec: number, intermediate: boolean) =>
  testScoreEvent({
    span_id,
    intermediate,
    score: testScore({ value: 1 }),
    timestamp: at(sec),
  });

const stateEvent = (span_id: string, sec: number) =>
  testStateEvent({ span_id, timestamp: at(sec) });

// --- assertion helper: collect every leaf event type in the built tree ------
function collectEventTypes(span: TimelineSpan): string[] {
  const out: string[] = [];
  for (const c of span.content) {
    if (c.type === "event") {
      out.push(c.event.event);
    } else {
      out.push(...collectEventTypes(c));
    }
  }
  for (const b of span.branches) {
    out.push(...collectEventTypes(b));
  }
  return out;
}

// Count nested spans of a given spanType anywhere under `span`. Used to detect
// whether the redundant solver wrapper was kept (double-nesting) or collapsed.
// NOTE FOR IMPLEMENTER: if a kept solver span surfaces under a different
// spanType label than "solver", adjust this string to match what
// buildSpanFromAgentSpan assigns (grep `spanType` in core.ts).
function countSubSpansOfType(span: TimelineSpan, spanType: string): number {
  let n = 0;
  for (const c of span.content) {
    if (c.type !== "event") {
      if (c.spanType === spanType) n += 1;
      n += countSubSpansOfType(c, spanType);
    }
  }
  return n;
}

describe("timeline solver child events", () => {
  it("A: keeps solver-level info and intermediate score when the solver wraps an agent", () => {
    const events: Event[] = [
      spanBegin("solvers", null, "solvers", "solvers", 0),
      spanBegin("solver", "solvers", "react_with_gated_submit", "solver", 1),
      spanBegin("agent", "solver", "react", "agent", 2),
      modelEvent("agent", 3),
      spanEnd("agent", 4),
      infoEvent("solver", 5),
      scoreEvent("solver", 6, true),
      stateEvent("solver", 7),
      spanEnd("solver", 8),
      spanEnd("solvers", 9),
    ];

    const timeline: Timeline = buildTimeline(events);
    const types = collectEventTypes(timeline.root);

    expect(types).toContain("info");
    expect(types).toContain("score");
    expect(types).toContain("model"); // the agent's model call is still present
    // The solver wrapper is KEPT (not collapsed) so its events can render.
    // NOTE: buildSpanFromAgentSpan hardcodes spanType="agent" for both solver
    // and agent SpanNodes (see core.ts), so a kept (non-collapsed) solver span
    // surfaces with spanType "agent", not "solver" — count "agent" spans to
    // detect the double-nesting instead.
    expect(countSubSpansOfType(timeline.root, "agent")).toBeGreaterThanOrEqual(
      1
    );
  });

  it("B: still flattens solver→agent to a single lane when extras are only state/store", () => {
    const events: Event[] = [
      spanBegin("solvers", null, "solvers", "solvers", 0),
      spanBegin("solver", "solvers", "basic_solver", "solver", 1),
      spanBegin("agent", "solver", "react", "agent", 2),
      modelEvent("agent", 3),
      spanEnd("agent", 4),
      stateEvent("solver", 5),
      spanEnd("solver", 6),
      spanEnd("solvers", 7),
    ];

    const timeline: Timeline = buildTimeline(events);

    // No double nesting: with only state/store extras the solver→agent wrapper
    // is collapsed, so NO extra nested "agent"-spanType span is retained under
    // root (the tempting wrong fix, `children.length !== 1`, would keep it and
    // regress this).
    expect(countSubSpansOfType(timeline.root, "agent")).toBe(0);
    // Nothing lost: the agent's model call still renders.
    expect(collectEventTypes(timeline.root)).toContain("model");
  });
});
