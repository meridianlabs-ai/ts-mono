/**
 * Shared conversation fixtures for message-row model tests, exported via
 * `@tsmono/inspect-components/chat/test-helpers`. Used both by rowsModel's
 * own tests and by app-level windowed sources that must reproduce
 * rowsModel's output over the same hazards.
 */
import {
  testAssistantMessage,
  testSystemMessage,
  testToolCall,
  testToolMessage,
  testUserMessage,
} from "@tsmono/inspect-common/testing";
import type { ChatMessage } from "@tsmono/inspect-common/types";

// a conversation exercising every windowing hazard: minted ids (no message
// carries an id field — the builders don't set one), a merged-away
// mid-conversation system message, a tool message trailing that system
// message (dropped by the fold), an assistant row whose chat message is
// skipped from numbering (tool calls, no visible content), and multi-tool
// runs
export const kitchenSink: ChatMessage[] = [
  testSystemMessage({ content: "be helpful" }),
  testUserMessage({ content: "hi" }),
  testAssistantMessage({
    content: "",
    tool_calls: [
      testToolCall({ id: "c-1", function: "bash" }),
      testToolCall({ id: "c-2", function: "python" }),
    ],
  }),
  testToolMessage({ content: "ok", tool_call_id: "c-1" }),
  testToolMessage({ content: "ok", tool_call_id: "c-2" }),
  testSystemMessage({ content: "mid-conversation system" }),
  testToolMessage({
    content: "orphaned by the system fold",
    tool_call_id: "c-2",
  }),
  testAssistantMessage({ content: "done" }),
  testUserMessage({ content: "more" }),
  testAssistantMessage({
    content: "using a tool",
    tool_calls: [testToolCall({ id: "c-3", function: "bash" })],
  }),
  testToolMessage({ content: "ok", tool_call_id: "c-3" }),
  testAssistantMessage({ content: "bye" }),
];

export const leadingTools: ChatMessage[] = [
  testToolMessage({ content: "orphan", tool_call_id: "c-0" }),
  testUserMessage({ content: "hi" }),
  testAssistantMessage({ content: "hello" }),
];

export const noSystem: ChatMessage[] = [
  testUserMessage({ content: "hi" }),
  testAssistantMessage({ content: "hello" }),
];
