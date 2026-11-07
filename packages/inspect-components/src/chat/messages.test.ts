import { describe, expect, it } from "vitest";

import {
  testAssistantMessage,
  testSystemMessage,
  testToolCall,
  testToolMessage,
  testUserMessage,
} from "@tsmono/inspect-common/testing";
import type { ChatMessage } from "@tsmono/inspect-common/types";

import { resolveMessages } from "./messages";

// =============================================================================
// Test data: assistant with tool_calls followed by a tool response
// =============================================================================

const messagesWithTool: ChatMessage[] = [
  testUserMessage({ content: "What is the weather?" }),
  testAssistantMessage({
    id: "asst-1",
    content: "Let me check.",
    tool_calls: [
      testToolCall({
        id: "call-1",
        function: "get_weather",
        arguments: { location: "NYC" },
      }),
    ],
  }),
  testToolMessage({
    id: "tool-1",
    content: "72F and sunny",
    tool_call_id: "call-1",
    function: "get_weather",
  }),
];

// =============================================================================
// resolveMessages — the core of collapseToolMessages behaviour
// =============================================================================

describe("resolveMessages", () => {
  it("collapses tool messages into the preceding assistant message", () => {
    const resolved = resolveMessages(messagesWithTool);

    // Tool message merged into assistant row → 2 resolved messages (user + assistant)
    // (system messages are filtered out, but there are none here)
    expect(resolved).toHaveLength(2);
    expect(resolved[0]!.message.role).toBe("user");
    expect(resolved[1]!.message.role).toBe("assistant");
    expect(resolved[1]!.toolMessages).toHaveLength(1);
    expect(resolved[1]!.toolMessages[0]!.role).toBe("tool");
  });

  it("skipping resolveMessages keeps each message separate", () => {
    // This is the collapseToolMessages: false path in ChatView/ChatViewVirtualList
    const unresolved = messagesWithTool.map((msg) => ({
      message: msg,
      toolMessages: [],
    }));

    // All 3 messages become separate rows with empty toolMessages
    expect(unresolved).toHaveLength(3);
    expect(unresolved[0]!.message.role).toBe("user");
    expect(unresolved[1]!.message.role).toBe("assistant");
    expect(unresolved[2]!.message.role).toBe("tool");
    expect(unresolved[1]!.toolMessages).toHaveLength(0);
  });

  it("assigns stable ids to messages without ids", () => {
    const noIdMessages: ChatMessage[] = [
      testUserMessage({ content: "Hello" }),
      testAssistantMessage({ content: "Hi" }),
    ];

    const resolved = resolveMessages(noIdMessages);
    expect(resolved[0]!.message.id).toBe("msg-0");
    expect(resolved[1]!.message.id).toBe("msg-1");
  });

  it("handles multiple tool calls from one assistant message", () => {
    const multiToolMessages: ChatMessage[] = [
      testAssistantMessage({
        id: "asst-multi",
        content: "Checking two things.",
        tool_calls: [
          testToolCall({ id: "call-a", function: "fn_a" }),
          testToolCall({ id: "call-b", function: "fn_b" }),
        ],
      }),
      testToolMessage({
        id: "tool-a",
        content: "result a",
        tool_call_id: "call-a",
        function: "fn_a",
      }),
      testToolMessage({
        id: "tool-b",
        content: "result b",
        tool_call_id: "call-b",
        function: "fn_b",
      }),
    ];

    const resolved = resolveMessages(multiToolMessages);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.toolMessages).toHaveLength(2);
  });

  it("collapses multiple system messages into one prepended entry", () => {
    const withSystem: ChatMessage[] = [
      testSystemMessage({ content: "You are helpful." }),
      testSystemMessage({ content: "Be concise." }),
      testUserMessage({ content: "Hello" }),
      testAssistantMessage({ content: "Hi" }),
    ];

    const resolved = resolveMessages(withSystem);
    // Two system messages collapsed into one, prepended → system + user + assistant = 3
    expect(resolved).toHaveLength(3);
    expect(resolved[0]!.message.role).toBe("system");
    expect(resolved[1]!.message.role).toBe("user");
    expect(resolved[2]!.message.role).toBe("assistant");
  });
});
