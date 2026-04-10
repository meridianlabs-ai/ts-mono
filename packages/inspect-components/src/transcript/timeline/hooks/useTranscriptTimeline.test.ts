// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type {
  Event,
  Timeline as ServerTimeline,
  TimelineEvent as ServerTimelineEvent,
  TimelineSpan as ServerTimelineSpan,
} from "@tsmono/inspect-common/types";

import { useTranscriptTimeline } from "./useTranscriptTimeline";

// =============================================================================
// Helpers
// =============================================================================

function makeModelEvent(uuid: string, startSec: number, endSec: number): Event {
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
        input_tokens: 60,
        output_tokens: 40,
        total_tokens: 100,
      },
      time: endSec - startSec,
    },
    config: {},
    tools: [],
    tool_choice: "auto",
    timestamp: new Date(1705312800000 + startSec * 1000).toISOString(),
    working_start: startSec,
    working_time: endSec - startSec,
    error: null,
    traceback_ansi: null,
  } as unknown as Event;
}

function makeServerEvent(uuid: string): ServerTimelineEvent {
  return { type: "event", event: uuid } as ServerTimelineEvent;
}

function makeServerSpan(
  overrides: Partial<ServerTimelineSpan> & { id: string; name: string }
): ServerTimelineSpan {
  return {
    type: "span",
    span_type: null,
    content: [],
    branches: [],
    branched_from: null,
    description: null,
    utility: false,
    agent_result: null,
    outline: null,
    ...overrides,
  } as ServerTimelineSpan;
}

// =============================================================================
// useTranscriptTimeline hook
// =============================================================================

describe("useTranscriptTimeline", () => {
  const events = [
    makeModelEvent("evt-1", 0, 3),
    makeModelEvent("evt-2", 4, 8),
    makeModelEvent("evt-3", 9, 12),
  ];

  const serverTimeline: ServerTimeline = {
    name: "default",
    description: "Test timeline",
    root: makeServerSpan({
      id: "root",
      name: "Transcript",
      content: [
        makeServerEvent("evt-1"),
        makeServerSpan({
          id: "agent-a",
          name: "Agent A",
          span_type: "agent",
          content: [makeServerEvent("evt-2")],
        }),
        makeServerSpan({
          id: "agent-b",
          name: "Agent B",
          span_type: "agent",
          content: [makeServerEvent("evt-3")],
        }),
      ],
    }),
  };

  it("builds timeline from events with server timelines", () => {
    const { result } = renderHook(() =>
      useTranscriptTimeline({
        events,
        serverTimelines: [serverTimeline],
      })
    );

    expect(result.current.timeline).toBeDefined();
    expect(result.current.timeline.root.name).toBe("Transcript");
    expect(result.current.hasTimeline).toBe(true);
  });

  it("returns all events when no swimlane row is selected", () => {
    const { result } = renderHook(() =>
      useTranscriptTimeline({
        events,
        serverTimelines: [serverTimeline],
      })
    );

    // Default selection is root — all events should be returned
    expect(result.current.selectedEvents.length).toBeGreaterThanOrEqual(
      events.length
    );
  });

  it("computes layouts for swimlane rows", () => {
    const { result } = renderHook(() =>
      useTranscriptTimeline({
        events,
        serverTimelines: [serverTimeline],
      })
    );

    // Should have layouts for root + agent rows
    expect(result.current.layouts.length).toBeGreaterThan(0);
  });

  it("reports hasTimeline false for flat events without structure", () => {
    const flatEvents = [makeModelEvent("flat-1", 0, 3)];
    const { result } = renderHook(() =>
      useTranscriptTimeline({ events: flatEvents })
    );

    // A single event with no child spans — no meaningful timeline
    expect(result.current.hasTimeline).toBe(false);
  });

  it("returns timelines array with server-provided timeline", () => {
    const { result } = renderHook(() =>
      useTranscriptTimeline({
        events,
        serverTimelines: [serverTimeline],
      })
    );

    expect(result.current.timelines).toHaveLength(1);
    expect(result.current.activeTimelineIndex).toBe(0);
  });

  it("outlineAgentName defaults to root name", () => {
    const { result } = renderHook(() =>
      useTranscriptTimeline({
        events,
        serverTimelines: [serverTimeline],
      })
    );

    expect(result.current.outlineAgentName).toBe("Transcript");
  });

  it("highlightedKeys is empty when no branch is selected", () => {
    const { result } = renderHook(() =>
      useTranscriptTimeline({
        events,
        serverTimelines: [serverTimeline],
      })
    );

    expect(result.current.highlightedKeys.size).toBe(0);
  });

  it("branchScrollTarget is null when no branch is selected", () => {
    const { result } = renderHook(() =>
      useTranscriptTimeline({
        events,
        serverTimelines: [serverTimeline],
      })
    );

    expect(result.current.branchScrollTarget).toBeNull();
  });

  it("builds timeline from raw events without server timelines", () => {
    const { result } = renderHook(() => useTranscriptTimeline({ events }));

    expect(result.current.timeline).toBeDefined();
    expect(result.current.timelines).toHaveLength(1);
    expect(result.current.selectedEvents.length).toBeGreaterThan(0);
  });
});
