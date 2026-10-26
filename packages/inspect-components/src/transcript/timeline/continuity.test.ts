import { afterEach, describe, expect, it, vi } from "vitest";

import {
  testAssistantMessage,
  testChatCompletionChoice,
  testModelEvent,
  testModelOutput,
  testSpanBeginEvent,
  testSpanEndEvent,
  testSystemMessage,
  testUserMessage,
} from "@tsmono/inspect-common/testing";
import type {
  ChatMessage,
  ChatMessageAssistant,
  Event,
} from "@tsmono/inspect-common/types";

import { buildTimeline, countUtilitySpans, TimelineSpan } from "./core";

/**
 * `segments` times: the agent rebuilds its input, makes four side calls with
 * inputs of four other lengths, then carries on the rebuilt call; no origins
 * (inspect_ai's `_moves_past_side_calls`).
 */
function movesPastSideCalls(segments: number): Event[] {
  let tick = 0;
  const timestamp = () =>
    new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString();
  const model = (input: ChatMessage[], output: ChatMessageAssistant) =>
    testModelEvent({
      timestamp: timestamp(),
      span_id: "main",
      input,
      output: testModelOutput({
        choices: [testChatCompletionChoice({ message: output })],
      }),
    });
  const system = testSystemMessage({ content: "You are the main agent." });
  const events: Event[] = [
    testSpanBeginEvent({
      id: "main",
      name: "main",
      type: "agent",
      timestamp: timestamp(),
    }),
  ];
  for (let k = 0; k < segments; k++) {
    const rebuilt = [
      system,
      testUserMessage({ content: `Earlier, part ${k}.` }),
    ];
    const answer = testAssistantMessage({ content: `Part ${k}.` });
    events.push(model(rebuilt, answer));
    for (let n = 0; n < 4; n++) {
      const notes = Array.from({ length: n + 2 }, (_, i) =>
        testUserMessage({ content: `Note ${k}.${i}.` })
      );
      events.push(
        model([system, ...notes], testAssistantMessage({ content: "noted" }))
      );
    }
    events.push(
      model(
        [...rebuilt, answer, testUserMessage({ content: "Go on." })],
        testAssistantMessage({ content: `Done ${k}.` })
      )
    );
  }
  events.push(testSpanEndEvent({ id: "main", timestamp: timestamp() }));
  return events;
}

/** Map lookups while building, which include each open-call lookup. */
function lookups(segments: number): { count: number; utility: number } {
  const events = movesPastSideCalls(segments);
  const gets = vi.spyOn(Map.prototype, "get");
  const root = buildTimeline(events).root;
  const count = gets.mock.calls.length;
  vi.restoreAllMocks();
  const [main] = root.content.filter(
    (item): item is TimelineSpan => item.type === "span"
  );
  return { count, utility: countUtilitySpans(main!) };
}

describe("continuity", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("moves past side calls of many input lengths in linear work", () => {
    const small = lookups(50);
    const large = lookups(100);
    expect(large.count).toBeLessThanOrEqual(2.2 * small.count + 10);
    expect(large.utility).toBe(4 * 100);
  });
});
