/**
 * Shared conversation fixtures for message-row model tests, exported via
 * `@tsmono/inspect-components/chat/test-helpers`. Used both by rowsModel's
 * own tests and by app-level windowed sources that must reproduce
 * rowsModel's output over the same hazards.
 */
import type { ChatMessage } from "@tsmono/inspect-common/types";

// a conversation exercising every windowing hazard: minted ids (no id
// fields anywhere), a merged-away mid-conversation system message, a tool
// message trailing that system message (dropped by the fold), an
// assistant row whose chat message is skipped from numbering (tool calls,
// no visible content), and multi-tool runs
export const kitchenSink: ChatMessage[] = [
  { role: "system", content: "be helpful" },
  { role: "user", content: "hi" },
  {
    role: "assistant",
    content: "",
    tool_calls: [
      { id: "c-1", function: "bash", arguments: {}, type: "function" },
      { id: "c-2", function: "python", arguments: {}, type: "function" },
    ],
  },
  { role: "tool", content: "ok", tool_call_id: "c-1" },
  { role: "tool", content: "ok", tool_call_id: "c-2" },
  { role: "system", content: "mid-conversation system" },
  { role: "tool", content: "orphaned by the system fold", tool_call_id: "c-2" },
  { role: "assistant", content: "done" },
  { role: "user", content: "more" },
  {
    role: "assistant",
    content: "using a tool",
    tool_calls: [
      { id: "c-3", function: "bash", arguments: {}, type: "function" },
    ],
  },
  { role: "tool", content: "ok", tool_call_id: "c-3" },
  { role: "assistant", content: "bye" },
];

export const leadingTools: ChatMessage[] = [
  { role: "tool", content: "orphan", tool_call_id: "c-0" },
  { role: "user", content: "hi" },
  { role: "assistant", content: "hello" },
];

export const noSystem: ChatMessage[] = [
  { role: "user", content: "hi" },
  { role: "assistant", content: "hello" },
];
