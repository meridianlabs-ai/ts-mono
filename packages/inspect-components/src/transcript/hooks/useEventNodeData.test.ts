import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  testAssistantMessage,
  testChatCompletionChoice,
  testModelEvent,
  testModelOutput,
  testToolEvent,
  testUserMessage,
} from "@tsmono/inspect-common/testing";
import type { Event } from "@tsmono/inspect-common/types";

import { useEventNodeData } from "./useEventNodeData";

// =============================================================================
// Fixtures
// =============================================================================

function makeModelEvent(uuid: string, messageId: string): Event {
  return testModelEvent({
    uuid,
    input: [testUserMessage({ id: messageId, content: "hi" })],
    output: testModelOutput({
      choices: [
        testChatCompletionChoice({
          message: testAssistantMessage({ content: "response" }),
        }),
      ],
      completion: "response",
    }),
    timestamp: "2024-01-01T00:00:00Z",
    working_time: 1,
    error: null,
    pending: false,
    span_id: null,
  });
}

function makeToolEvent(id: string, messageId: string): Event {
  return testToolEvent({
    id,
    uuid: `uuid-${id}`,
    message_id: messageId,
    function: "search",
    result: "ok",
    error: null,
    agent: null,
    failed: null,
    timestamp: "2024-01-01T00:00:01Z",
    working_start: 1,
    pending: false,
    span_id: null,
  });
}

// =============================================================================
// useEventNodeData
// =============================================================================

describe("useEventNodeData", () => {
  const events = [makeModelEvent("e1", "m1"), makeToolEvent("t1", "m2")];
  const feed = { events, sourceSpans: undefined };

  it("builds event nodes from the feed", () => {
    const { result } = renderHook(() => useEventNodeData(feed, false));
    expect(result.current.eventNodes.length).toBeGreaterThan(0);
    expect(result.current.eventNodeContext.retryAttempts).toBeInstanceOf(Map);
  });

  it("scopes message labels and derives tool labels", () => {
    const { result } = renderHook(() =>
      useEventNodeData(feed, false, {
        inlineExpansionUX: true,
        messageLabels: { m1: "A", m2: "B", absent: "C" },
      })
    );
    const context = result.current.eventNodeContext;
    expect(context.messageLabels).toEqual({ m1: "A", m2: "B" });
    expect(context.toolLabels).toEqual({ t1: "B" });
    // Caller extras pass through the merge.
    expect(context.inlineExpansionUX).toBe(true);
  });

  it("preserves derived identities when feed and context are unchanged", () => {
    const extraContext = {
      inlineExpansionUX: true,
      messageLabels: { m1: "A", m2: "B" },
    };
    const { result, rerender } = renderHook(() =>
      useEventNodeData(feed, false, extraContext)
    );
    const firstEventNodes = result.current.eventNodes;
    const firstDefaultCollapsedIds = result.current.defaultCollapsedIds;
    const firstEventNodeContext = result.current.eventNodeContext;

    rerender();

    expect(result.current.eventNodes).toBe(firstEventNodes);
    expect(result.current.defaultCollapsedIds).toBe(firstDefaultCollapsedIds);
    expect(result.current.eventNodeContext).toBe(firstEventNodeContext);
  });
});
