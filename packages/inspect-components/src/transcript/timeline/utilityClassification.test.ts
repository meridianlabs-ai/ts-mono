/**
 * Regression tests for utility-agent classification gating.
 *
 * Utility detection (both the foreign-prompt event wrapping and the
 * single-turn span classification) only applies when there is an agentic
 * (tool-calling) main loop to be subordinate to. A plain workflow of
 * generate() calls with mixed system prompts — e.g. a monitor making several
 * checker calls — must render every call, not hide the ones whose prompt
 * differs from the first. Mirrors the Python `_wrap_utility_events` /
 * `_classify_utility_agents` gating.
 */

import { describe, expect, it } from "vitest";

import type { Event } from "@tsmono/inspect-common/types";

import { buildTimeline, TimelineSpan } from "./core";

let clock = 0;
function ts(): string {
  clock += 1;
  return new Date(Date.UTC(2026, 0, 1, 0, 0, clock)).toISOString();
}

const base = () => ({
  uuid: null,
  timestamp: ts(),
  working_start: 0,
  pending: false,
  metadata: null,
});

function spanBegin(
  id: string,
  name: string,
  type: string | null,
  parentId: string | null
): Event {
  return {
    ...base(),
    event: "span_begin",
    id,
    name,
    type,
    parent_id: parentId,
    span_id: null,
  } as unknown as Event;
}

function spanEnd(id: string): Event {
  return {
    ...base(),
    event: "span_end",
    id,
    span_id: null,
  } as unknown as Event;
}

function modelTurn(
  spanId: string,
  systemPrompt: string,
  options?: { toolCalls?: boolean }
): Event {
  return {
    ...base(),
    event: "model",
    model: "mockllm/model",
    completed: ts(),
    span_id: spanId,
    input: [
      { role: "system", content: systemPrompt },
      { role: "user", content: "go" },
    ],
    output: {
      choices: [
        {
          message: {
            role: "assistant",
            content: "ok",
            tool_calls: options?.toolCalls
              ? [{ id: "call_1", function: "search", arguments: {} }]
              : null,
          },
          stop_reason: options?.toolCalls ? "tool_calls" : "stop",
        },
      ],
      usage: { input_tokens: 5, output_tokens: 1 },
    },
  } as unknown as Event;
}

function toolEvent(spanId: string): Event {
  return {
    ...base(),
    event: "tool",
    id: "call_1",
    function: "search",
    completed: ts(),
    agent: null,
    events: [],
    span_id: spanId,
    result: "found it",
  } as unknown as Event;
}

function directModelPrompts(span: TimelineSpan): string[] {
  const prompts: string[] = [];
  for (const item of span.content) {
    if (item.type === "event" && item.event.event === "model") {
      const sys = (item.event.input ?? []).find((m) => m.role === "system");
      if (typeof sys?.content === "string") prompts.push(sys.content);
    }
  }
  return prompts;
}

function collectUtilitySpans(span: TimelineSpan): TimelineSpan[] {
  const result: TimelineSpan[] = [];
  if (span.utility) result.push(span);
  for (const item of span.content) {
    if (item.type === "span") result.push(...collectUtilitySpans(item));
  }
  return result;
}

function findSpan(span: TimelineSpan, name: string): TimelineSpan | null {
  if (span.name === name) return span;
  for (const item of span.content) {
    if (item.type === "span") {
      const found = findSpan(item, name);
      if (found) return found;
    }
  }
  return null;
}

describe("foreign-prompt event wrapping (wrapUtilityEvents)", () => {
  it("leaves all calls visible in a workflow with no tool-calling loop", () => {
    // A monitor-style solver: five generate() calls, two prompts groups,
    // no tool calls anywhere. Previously the first call's prompt was adopted
    // as "primary" and the other prompt group was hidden as utility.
    const events: Event[] = [
      spanBegin("solvers", "solvers", "solvers", null),
      spanBegin("solver", "monitor", "solver", "solvers"),
      modelTurn("solver", "X-EXTRACT"),
      modelTurn("solver", "X-EXTRACT"),
      modelTurn("solver", "Y-EXTRACT"),
      modelTurn("solver", "Y-GROUND"),
      modelTurn("solver", "Y-GROUND"),
      spanEnd("solver"),
      spanEnd("solvers"),
    ];

    const timeline = buildTimeline(events);
    expect(collectUtilitySpans(timeline.root)).toHaveLength(0);
    expect(directModelPrompts(timeline.root)).toEqual([
      "X-EXTRACT",
      "X-EXTRACT",
      "Y-EXTRACT",
      "Y-GROUND",
      "Y-GROUND",
    ]);
  });

  it("still wraps foreign-prompt calls inside a tool-calling loop", () => {
    // Bridge-style shape: a tool-calling main loop with an interleaved
    // extraction call using a different prompt and no tool calls.
    const events: Event[] = [
      spanBegin("solvers", "solvers", "solvers", null),
      spanBegin("solver", "bridge", "solver", "solvers"),
      modelTurn("solver", "MAIN", { toolCalls: true }),
      toolEvent("solver"),
      modelTurn("solver", "EXTRACT"),
      modelTurn("solver", "MAIN"),
      spanEnd("solver"),
      spanEnd("solvers"),
    ];

    const timeline = buildTimeline(events);
    const utility = collectUtilitySpans(timeline.root);
    expect(utility).toHaveLength(1);
    expect(directModelPrompts(utility[0]!)).toEqual(["EXTRACT"]);
    // Main-loop calls remain direct content of the agent
    expect(directModelPrompts(timeline.root)).toEqual(["MAIN", "MAIN"]);
  });
});

describe("single-turn span classification (classifyUtilityAgents)", () => {
  it("does not classify sub-spans when the parent has no tool-calling loop", () => {
    const events: Event[] = [
      spanBegin("solvers", "solvers", "solvers", null),
      spanBegin("monitor", "monitor", "agent", "solvers"),
      modelTurn("monitor", "MAIN"),
      spanBegin("helper", "helper", "agent", "monitor"),
      modelTurn("helper", "HELPER"),
      spanEnd("helper"),
      spanEnd("monitor"),
      spanEnd("solvers"),
    ];

    const timeline = buildTimeline(events);
    expect(collectUtilitySpans(timeline.root)).toHaveLength(0);
    // Guard against vacuous passes from restructuring: both the parent turn
    // and the helper span must be present in the built tree.
    expect(directModelPrompts(timeline.root)).toEqual(["MAIN"]);
    expect(findSpan(timeline.root, "helper")).not.toBeNull();
  });

  it("classifies a single-turn foreign-prompt sub-span under a tool-calling loop", () => {
    const events: Event[] = [
      spanBegin("solvers", "solvers", "solvers", null),
      spanBegin("bridge", "bridge", "agent", "solvers"),
      modelTurn("bridge", "MAIN", { toolCalls: true }),
      toolEvent("bridge"),
      spanBegin("helper", "helper", "agent", "bridge"),
      modelTurn("helper", "HELPER"),
      spanEnd("helper"),
      modelTurn("bridge", "MAIN"),
      spanEnd("bridge"),
      spanEnd("solvers"),
    ];

    const timeline = buildTimeline(events);
    const utility = collectUtilitySpans(timeline.root);
    expect(utility).toHaveLength(1);
    expect(utility[0]!.name).toBe("helper");
  });
});
