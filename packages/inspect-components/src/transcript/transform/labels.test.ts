import { describe, expect, it } from "vitest";

import {
  testAssistantMessage,
  testChatCompletionChoice,
  testModelEvent,
  testModelOutput,
  testToolEvent,
  testToolMessage,
  testUserMessage,
} from "@tsmono/inspect-common/testing";
import type { Event, ModelEvent } from "@tsmono/inspect-common/types";

import { buildToolLabels, scopeMessageLabels } from "./labels";

// =============================================================================
// Fixtures
// =============================================================================

function modelEvent(
  input: ModelEvent["input"],
  choiceIds: string[] = []
): Event {
  return testModelEvent({
    input,
    output: testModelOutput({
      choices: choiceIds.map((id) =>
        testChatCompletionChoice({
          message: testAssistantMessage({ id, content: "" }),
        })
      ),
    }),
  });
}

function toolEvent(id: string, messageId: string | null): Event {
  return testToolEvent({ id, message_id: messageId });
}

// =============================================================================
// scopeMessageLabels
// =============================================================================

describe("scopeMessageLabels", () => {
  it("returns undefined when no labels are provided", () => {
    expect(scopeMessageLabels([modelEvent([])], undefined)).toBeUndefined();
  });

  it.each([
    {
      desc: "model input message",
      events: [modelEvent([testUserMessage({ id: "m1" })])],
    },
    {
      desc: "model output choice",
      events: [modelEvent([], ["m1"])],
    },
    {
      desc: "tool event message_id",
      events: [toolEvent("t1", "m1")],
    },
  ])("keeps labels for a $desc, drops absent ones", ({ events }) => {
    expect(scopeMessageLabels(events, { m1: "A", absent: "B" })).toEqual({
      m1: "A",
    });
  });

  it("returns undefined when no labeled message is present", () => {
    const events = [modelEvent([testUserMessage({ id: "m1" })])];
    expect(scopeMessageLabels(events, { other: "X" })).toBeUndefined();
  });
});

// =============================================================================
// buildToolLabels
// =============================================================================

describe("buildToolLabels", () => {
  it("returns undefined when no message labels are provided", () => {
    expect(buildToolLabels([toolEvent("t1", "m1")], undefined)).toBeUndefined();
  });

  it("labels tool events via their message_id", () => {
    const events = [toolEvent("t1", "m1"), toolEvent("t2", "unlabeled")];
    expect(buildToolLabels(events, { m1: "A" })).toEqual({ t1: "A" });
  });

  it("labels tool calls via tool-role input messages on model events", () => {
    const events = [
      modelEvent([
        testToolMessage({ id: "m1", tool_call_id: "call1" }),
        testUserMessage({ id: "m2", tool_call_id: ["call2"] }),
      ]),
    ];
    // The user-role message must not produce a label even though m2 is labeled.
    expect(buildToolLabels(events, { m1: "A", m2: "B" })).toEqual({
      call1: "A",
    });
  });

  it("returns undefined when nothing matches", () => {
    const events = [toolEvent("t1", null)];
    expect(buildToolLabels(events, { m1: "A" })).toBeUndefined();
  });
});
