// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  testAssistantMessage,
  testChatCompletionChoice,
  testModelEvent,
  testModelOutput,
  testModelUsage,
  testSpanBeginEvent,
  testSpanEndEvent,
  testTimelineEvent,
  testTimelineSpan,
} from "@tsmono/inspect-common/testing";
import type {
  Event,
  Timeline as ServerTimeline,
  TimelineSpan as ServerTimelineSpan,
} from "@tsmono/inspect-common/types";

import { findTimelineIndexForEvent } from "../../findTimelineForDeepLink";
import type { Timeline, TimelineSpan } from "../core";

import { useTimelinesArray } from "./useTimelinesArray";

function makeModelEvent(
  uuid: string,
  startSec: number,
  spanId: string | null = null
): Event {
  return testModelEvent({
    uuid,
    output: testModelOutput({
      choices: [
        testChatCompletionChoice({
          message: testAssistantMessage({
            content: "response",
            source: "generate",
          }),
        }),
      ],
      completion: "response",
      usage: testModelUsage({
        input_tokens: 1,
        output_tokens: 1,
        total_tokens: 2,
      }),
      time: 1,
    }),
    timestamp: new Date(1705312800000 + startSec * 1000).toISOString(),
    working_start: startSec,
    working_time: 1,
    span_id: spanId,
  });
}

function spanBegin(
  id: string,
  name: string,
  type: string,
  parentId: string | null = null
): Event {
  return testSpanBeginEvent({
    id,
    name,
    type,
    parent_id: parentId,
    timestamp: new Date(1705312800000).toISOString(),
    working_start: 0,
  });
}

function spanEnd(id: string): Event {
  return testSpanEndEvent({
    id,
    timestamp: new Date(1705312805000).toISOString(),
    working_start: 5,
  });
}

function makeServerSpan(
  id: string,
  name: string,
  events: string[]
): ServerTimelineSpan {
  return testTimelineSpan({
    id,
    name,
    content: events.map((event) => testTimelineEvent({ event })),
  });
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
  it("appends an Overall timeline for multiple timelines with orphan events", () => {
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
      "A",
      "B",
      "Overall",
    ]);
    expect(result.current[2]!.description).toBe("Full sample transcript");
    expect(eventUuids(result.current[0]!)).toEqual(["a-1"]);
    expect(eventUuids(result.current[1]!)).toEqual(["b-1"]);
    expect(eventUuids(result.current[2]!)).toEqual([
      "a-1",
      "b-1",
      "orphan-1",
      "orphan-2",
      "orphan-3",
    ]);
    expect(findTimelineIndexForEvent("a-1", result.current)).toBe(0);
  });

  it("does not merge a minority orphan set into a sibling timeline", () => {
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

    expect(result.current.map((timeline) => timeline.name)).toEqual([
      "A",
      "B",
      "Overall",
    ]);
    expect(eventUuids(result.current[0]!)).toEqual(["a-1"]);
    expect(eventUuids(result.current[1]!)).toEqual(["b-1"]);
    expect(eventUuids(result.current[2]!)).toEqual(["a-1", "b-1", "orphan-1"]);
  });

  it("keeps merging orphan events into a single server timeline", () => {
    const events = [
      makeModelEvent("a-1", 0),
      makeModelEvent("orphan-1", 1),
      makeModelEvent("orphan-2", 2),
    ];
    const serverTimelines = [makeServerTimeline("A", ["a-1"])];

    const { result } = renderHook(() =>
      useTimelinesArray(events, serverTimelines)
    );

    expect(result.current.map((timeline) => timeline.name)).toEqual(["A"]);
    expect(eventUuids(result.current[0]!)).toEqual([
      "a-1",
      "orphan-1",
      "orphan-2",
    ]);
  });

  it.each([
    { name: "self", parents: [{ id: "cycle", parent: "cycle" }] },
    {
      name: "two-span",
      parents: [
        { id: "cycle", parent: "other" },
        { id: "other", parent: "cycle" },
      ],
    },
    {
      name: "ancestor",
      parents: [
        { id: "leaf", parent: "cycle" },
        { id: "cycle", parent: "other" },
        { id: "other", parent: "cycle" },
      ],
    },
  ])(
    "rejects a $name parent cycle instead of hanging the transcript",
    ({ parents }) => {
      const events = [
        makeModelEvent("referenced", 0),
        ...parents.map(({ id, parent }) => spanBegin(id, id, "agent", parent)),
        makeModelEvent("orphan", 1, parents[0]!.id),
      ];

      expect(() =>
        renderHook(() =>
          useTimelinesArray(events, [makeServerTimeline("A", ["referenced"])])
        )
      ).toThrow("Invalid transcript: cyclic span parent chain");
    }
  );

  it("preserves nested orphan spans and events sharing an ancestor", () => {
    const events = [
      makeModelEvent("referenced", 0),
      spanBegin("parent", "parent", "agent"),
      spanBegin("child", "child", "agent", "parent"),
      makeModelEvent("child-event", 1, "child"),
      makeModelEvent("parent-event", 2, "parent"),
      makeModelEvent("root-event", 3),
    ];
    const { result } = renderHook(() =>
      useTimelinesArray(events, [makeServerTimeline("A", ["referenced"])])
    );

    expect(eventUuids(result.current[0]!)).toEqual([
      "referenced",
      "child-event",
      "parent-event",
      "root-event",
    ]);
    const parent = result.current[0]!.root.content.find(
      (item) => item.type === "span"
    );
    expect(parent?.id).toBe("parent");
    expect(parent?.content[0]).toMatchObject({ type: "span", id: "child" });
  });

  it.each([null, "missing"])(
    "promotes orphans below a referenced span whose parent is %s",
    (parentId) => {
      const events = [
        spanBegin("ancestor", "ancestor", "agent", parentId),
        spanBegin("represented", "represented", "agent", "ancestor"),
        makeModelEvent("referenced", 0, "represented"),
        spanBegin("orphan-span", "orphan-span", "agent", "represented"),
        makeModelEvent("orphan", 1, "orphan-span"),
      ];
      const server: ServerTimeline = {
        name: "A",
        description: "server description",
        root: makeServerSpan("represented", "Server root", ["referenced"]),
      };
      const { result } = renderHook(() => useTimelinesArray(events, [server]));

      expect(result.current[0]?.name).toBe("A");
      expect(result.current[0]?.description).toBe("server description");
      expect(result.current[0]?.root.name).toBe("Server root");
      expect(eventUuids(result.current[0]!)).toEqual(["referenced", "orphan"]);
      expect(result.current[0]?.root.content[1]).toMatchObject({
        type: "span",
        id: "orphan-span",
      });
    }
  );

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
