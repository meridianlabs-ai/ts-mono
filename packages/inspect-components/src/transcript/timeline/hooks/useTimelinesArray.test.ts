// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type {
  Event,
  Timeline as ServerTimeline,
  TimelineEvent as ServerTimelineEvent,
  TimelineSpan as ServerTimelineSpan,
} from "@tsmono/inspect-common/types";

import type { Timeline, TimelineSpan } from "../core";

import { useTimelinesArray } from "./useTimelinesArray";

function makeModelEvent(
  uuid: string,
  startSec: number,
  spanId: string | null = null
): Event {
  return {
    event: "model",
    uuid,
    model: "test-model",
    input: [],
    output: {
      choices: [
        {
          message: {
            role: "assistant",
            content: "response",
            source: "generate",
          },
          stop_reason: "stop",
        },
      ],
      completion: "response",
      model: "test-model",
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        total_tokens: 2,
      },
      time: 1,
    },
    config: {},
    tools: [],
    tool_choice: "auto",
    timestamp: new Date(1705312800000 + startSec * 1000).toISOString(),
    working_start: startSec,
    working_time: 1,
    span_id: spanId,
    error: null,
    traceback_ansi: null,
  } as unknown as Event;
}

function spanBegin(id: string, name: string, type: string): Event {
  return {
    event: "span_begin",
    id,
    name,
    type,
    parent_id: null,
    span_id: null,
    timestamp: new Date(1705312800000).toISOString(),
    working_start: 0,
    pending: null,
    uuid: null,
    metadata: null,
  } as unknown as Event;
}

function spanEnd(id: string): Event {
  return {
    event: "span_end",
    id,
    span_id: null,
    timestamp: new Date(1705312805000).toISOString(),
    working_start: 5,
    pending: null,
    uuid: null,
    metadata: null,
  } as unknown as Event;
}

function makeServerEvent(uuid: string): ServerTimelineEvent {
  return { type: "event", event: uuid };
}

function makeServerSpan(
  id: string,
  name: string,
  events: string[]
): ServerTimelineSpan {
  return {
    type: "span",
    id,
    name,
    span_type: null,
    content: events.map(makeServerEvent),
    branches: [],
    branched_from: null,
    description: null,
    utility: false,
    tool_invoked: false,
    agent_result: null,
    outline: null,
  };
}

function makeServerTimeline(name: string, events: string[]): ServerTimeline {
  return {
    name,
    description: `${name} timeline`,
    root: makeServerSpan(`${name.toLowerCase()}-root`, `${name} root`, events),
  };
}

function eventUuids(timeline: Timeline): string[] {
  const collect = (span: TimelineSpan): string[] =>
    [...span.content, ...span.branches].flatMap((item) => {
      if (item.type === "span") return collect(item);
      const uuid = item.event.uuid;
      return uuid ? [uuid] : [];
    });

  return collect(timeline.root);
}

describe("useTimelinesArray", () => {
  it("adds an Overall timeline when orphan events outnumber referenced events", () => {
    const events = [
      makeModelEvent("a-1", 0),
      makeModelEvent("b-1", 1),
      spanBegin("solvers", "solvers", "solvers"),
      makeModelEvent("orphan-1", 2, "solvers"),
      makeModelEvent("orphan-2", 3, "solvers"),
      makeModelEvent("orphan-3", 4, "solvers"),
      spanEnd("solvers"),
    ];
    const serverTimelines = [
      makeServerTimeline("A", ["a-1"]),
      makeServerTimeline("B", ["b-1"]),
    ];

    const { result } = renderHook(() =>
      useTimelinesArray(events, serverTimelines)
    );

    expect(result.current.map((timeline) => timeline.name)).toEqual([
      "Overall",
      "A",
      "B",
    ]);
    expect(result.current[0]!.description).toBe("Full sample transcript");
    expect(eventUuids(result.current[0]!)).toEqual([
      "a-1",
      "b-1",
      "orphan-1",
      "orphan-2",
      "orphan-3",
    ]);
    expect(eventUuids(result.current[1]!)).toEqual(["a-1"]);
    expect(eventUuids(result.current[2]!)).toEqual(["b-1"]);
  });

  it("keeps merging a small number of orphan events into the host timeline", () => {
    const events = [
      makeModelEvent("a-1", 0),
      makeModelEvent("b-1", 1),
      makeModelEvent("orphan-1", 2),
    ];
    const serverTimelines = [
      makeServerTimeline("A", ["a-1"]),
      makeServerTimeline("B", ["b-1"]),
    ];

    const { result } = renderHook(() =>
      useTimelinesArray(events, serverTimelines)
    );

    expect(result.current.map((timeline) => timeline.name)).toEqual(["A", "B"]);
    expect(eventUuids(result.current[0]!)).toEqual(["a-1", "orphan-1"]);
    expect(eventUuids(result.current[1]!)).toEqual(["b-1"]);
  });

  it("keeps host merging when orphan and referenced event counts are equal", () => {
    const events = [
      makeModelEvent("a-1", 0),
      makeModelEvent("b-1", 1),
      makeModelEvent("orphan-1", 2),
      makeModelEvent("orphan-2", 3),
    ];
    const serverTimelines = [
      makeServerTimeline("A", ["a-1"]),
      makeServerTimeline("B", ["b-1"]),
    ];

    const { result } = renderHook(() =>
      useTimelinesArray(events, serverTimelines)
    );

    expect(result.current.map((timeline) => timeline.name)).toEqual(["A", "B"]);
    expect(eventUuids(result.current[0]!)).toEqual([
      "a-1",
      "orphan-1",
      "orphan-2",
    ]);
    expect(eventUuids(result.current[1]!)).toEqual(["b-1"]);
  });

  it("preserves server timelines when there are no orphan events", () => {
    const events = [makeModelEvent("a-1", 0), makeModelEvent("b-1", 1)];
    const serverTimelines = [
      makeServerTimeline("A", ["a-1"]),
      makeServerTimeline("B", ["b-1"]),
    ];

    const { result } = renderHook(() =>
      useTimelinesArray(events, serverTimelines)
    );

    expect(result.current.map((timeline) => timeline.name)).toEqual(["A", "B"]);
    expect(eventUuids(result.current[0]!)).toEqual(["a-1"]);
    expect(eventUuids(result.current[1]!)).toEqual(["b-1"]);
  });
});
