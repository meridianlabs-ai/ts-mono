// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  testAnchorEvent,
  testAssistantMessage,
  testChatCompletionChoice,
  testInfoEvent,
  testModelEvent,
  testModelOutput,
  testTimelineEvent,
  testTimelineSpan,
} from "@tsmono/inspect-common/testing";
import type {
  AnchorEvent,
  Event,
  Timeline as ServerTimeline,
} from "@tsmono/inspect-common/types";

import { InMemoryStateWrapper } from "../testHelpers";

import { useTimelinePipeline } from "./useTimelinePipeline";

// =============================================================================
// Fixtures
// =============================================================================

function makeModelEvent(uuid: string, startSec: number): Event {
  return testModelEvent({
    uuid,
    output: testModelOutput({
      choices: [
        testChatCompletionChoice({
          message: testAssistantMessage({ content: "response" }),
        }),
      ],
      completion: "response",
    }),
    timestamp: new Date(1705312800000 + startSec * 1000).toISOString(),
    working_start: startSec,
    working_time: 1,
    error: null,
    pending: false,
    span_id: null,
  });
}

function makeInfoEvent(uuid: string, startSec: number): Event {
  return testInfoEvent({
    uuid,
    source: "test",
    data: "",
    timestamp: new Date(1705312800000 + startSec * 1000).toISOString(),
    working_start: startSec,
    pending: false,
    span_id: null,
  });
}

function makeAnchorEvent(
  uuid: string,
  anchorId: string,
  startSec: number
): AnchorEvent {
  return testAnchorEvent({
    uuid,
    anchor_id: anchorId,
    timestamp: new Date(1705312800000 + startSec * 1000).toISOString(),
    working_start: startSec,
  });
}

// =============================================================================
// useTimelinePipeline
// =============================================================================

describe("useTimelinePipeline", () => {
  const flatEvents = [makeModelEvent("e1", 0), makeInfoEvent("e2", 1)];

  it("hides swimlanes for a flat event stream and feeds all events", () => {
    const { result } = renderHook(
      () => useTimelinePipeline({ events: flatEvents }),
      { wrapper: InMemoryStateWrapper }
    );
    expect(result.current.showSwimlanes).toBe(false);
    expect(result.current.swimlanesDefaultCollapsed).toBe(true);
    // No filtering or selection: the feed and search set are the input array.
    expect(result.current.nodeFeed.events).toBe(flatEvents);
    expect(result.current.nodeFeed.sourceSpans).toBeUndefined();
    expect(result.current.searchableEvents).toBe(flatEvents);
  });

  it("honors an explicit showSwimlanes override", () => {
    const { result } = renderHook(
      () => useTimelinePipeline({ events: flatEvents, showSwimlanes: true }),
      { wrapper: InMemoryStateWrapper }
    );
    expect(result.current.showSwimlanes).toBe(true);
    // With swimlanes on the feed carries the (empty) source-span map.
    expect(result.current.nodeFeed.sourceSpans).toBeInstanceOf(Map);
  });

  it("keeps swimlane navigation visible in a flat punched-down branch", () => {
    const branchEvents = [
      makeModelEvent("main", 0),
      makeAnchorEvent("anchor", "fork-1", 1),
      makeModelEvent("branch-event", 2),
    ];
    const serverTimelines: ServerTimeline[] = [
      {
        name: "default",
        description: "Flat branch",
        root: testTimelineSpan({
          id: "root",
          name: "Transcript",
          content: [
            testTimelineEvent({ event: "main" }),
            testTimelineEvent({ event: "anchor" }),
          ],
          branches: [
            testTimelineSpan({
              id: "branch-1",
              name: "Branch 1",
              span_type: "branch",
              branched_from: "fork-1",
              content: [testTimelineEvent({ event: "branch-event" })],
            }),
          ],
        }),
      },
    ];
    const { result } = renderHook(
      () =>
        useTimelinePipeline({
          events: branchEvents,
          serverTimelines,
          agentConfig: { showBranches: true },
        }),
      { wrapper: InMemoryStateWrapper }
    );
    const branchRow = result.current.timeline.state.rows.find(
      (row) => row.branch
    );
    expect(branchRow).toBeDefined();

    act(() =>
      result.current.timeline.views.pushByRowKey(branchRow!.key, "Branch 1")
    );

    expect(result.current.timeline.views.stack).toHaveLength(1);
    expect(result.current.timeline.hasTimeline).toBe(false);
    expect(result.current.showSwimlanes).toBe(true);
  });

  it("filters hidden event types from the node feed and search set", () => {
    const { result } = renderHook(
      () =>
        useTimelinePipeline({
          events: flatEvents,
          hiddenEventTypes: ["info"],
        }),
      { wrapper: InMemoryStateWrapper }
    );
    expect(result.current.nodeFeed.events.map((e) => e.event)).toEqual([
      "model",
    ]);
    expect(result.current.searchableEvents.map((e) => e.event)).toEqual([
      "model",
    ]);
  });

  it("preserves feed and search identities when inputs are unchanged", () => {
    const hiddenEventTypes = ["info"];
    const { result, rerender } = renderHook(
      () =>
        useTimelinePipeline({
          events: flatEvents,
          hiddenEventTypes,
        }),
      { wrapper: InMemoryStateWrapper }
    );
    const firstNodeFeed = result.current.nodeFeed;
    const firstFeedEvents = result.current.nodeFeed.events;
    const firstSearchableEvents = result.current.searchableEvents;

    rerender();

    expect(result.current.nodeFeed).toBe(firstNodeFeed);
    expect(result.current.nodeFeed.events).toBe(firstFeedEvents);
    expect(result.current.searchableEvents).toBe(firstSearchableEvents);
  });

  it("always returns the full timeline pipeline result", () => {
    const { result } = renderHook(
      () => useTimelinePipeline({ events: flatEvents }),
      { wrapper: InMemoryStateWrapper }
    );
    expect(result.current.timeline.multiTimeline.timelines).toHaveLength(1);
    // Identity is not preserved here: the timeline pipeline re-sorts via
    // correctRetryTimestamps, so compare by value.
    expect(result.current.timeline.selection.events).toEqual(flatEvents);
    expect(result.current.timelineConfig.markerConfig).toBeDefined();
  });
});
