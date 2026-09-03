import { describe, expect, it } from "vitest";

import {
  testAssistantMessage,
  testSystemMessage,
  testToolMessage,
  testUserMessage,
} from "@tsmono/inspect-common/testing";
import type { ChatMessage } from "@tsmono/inspect-common/types";

import { recentInputMessages } from "./recentInputMessages";

// Fixture shapes mirror a real codex 0.147.0 / gpt-5.6-sol eval log: a
// Multi-Agent V2 spawn forks the parent's conversation into the child
// (user/system messages only — the fork strips assistant turns), then appends
// the fork-injected instructions and the agent_message task. The bridge marks
// each agent_message-derived user message by stashing the raw item on
// ContentText.internal.

let nextId = 0;
const msg = (role: ChatMessage["role"], text = "content"): ChatMessage => {
  const id = `m${nextId++}`;
  switch (role) {
    case "system":
      return testSystemMessage({ id, content: text });
    case "user":
      return testUserMessage({ id, content: text });
    case "assistant":
      return testAssistantMessage({ id, content: text });
    case "tool":
      return testToolMessage({ id, content: text });
  }
};

const handoffMsg = (text = "Agent message from /root:\ntask"): ChatMessage =>
  testUserMessage({
    id: `m${nextId++}`,
    content: [
      {
        type: "text",
        text,
        internal: {
          agent_message: {
            type: "agent_message",
            author: "/root",
            recipient: "/root/write_fizzbuzz",
          },
        },
      },
    ],
  });

const toolCallUser = (): ChatMessage =>
  testUserMessage({
    id: `m${nextId++}`,
    content: "output",
    tool_call_id: ["call_1"],
  });

const defaults = { agentResultsFiltered: false, hasToolEvents: undefined };

// Characterization of the pre-existing walk-back (transcribed from
// ModelEventView's userMessages memo). These pin current behavior — the
// fork-boundary fix below must not change any of them.
describe("recentInputMessages (existing behavior)", () => {
  it("collects trailing user/system messages up to the last assistant/tool", () => {
    const trailing = [msg("system"), msg("user"), msg("user")];
    const input = [msg("system"), msg("user"), msg("assistant"), ...trailing];
    expect(recentInputMessages(input, defaults)).toEqual(trailing);
  });

  it("shows the whole input when it is all user/system (e.g. first call)", () => {
    const input = [msg("system"), msg("user"), msg("user")];
    expect(recentInputMessages(input, defaults)).toEqual(input);
  });

  it("shows only the trailing assistant message when input ends with one", () => {
    // NOTE: slice(-1) means the walk examines only the assistant message and
    // stops — trailing-assistant events show just that message. Pinned as-is.
    const assistant = msg("assistant");
    const input = [msg("system"), msg("user"), assistant];
    expect(recentInputMessages(input, defaults)).toEqual([assistant]);
  });

  it("stops at a user message that is a tool call result", () => {
    const trailing = msg("user");
    const input = [msg("user"), toolCallUser(), trailing];
    expect(recentInputMessages(input, defaults)).toEqual([trailing]);
  });

  it("includes tool messages when the client has no tool events", () => {
    const tool = msg("tool");
    const user = msg("user");
    const input = [msg("assistant"), tool, user];
    expect(
      recentInputMessages(input, { ...defaults, hasToolEvents: false })
    ).toEqual([tool, user]);
  });

  it("hides tool messages when the client renders tool events", () => {
    const user = msg("user");
    const input = [msg("assistant"), msg("tool"), user];
    expect(
      recentInputMessages(input, { ...defaults, hasToolEvents: true })
    ).toEqual([user]);
  });

  it("returns nothing when agent results were filtered", () => {
    const input = [msg("user"), msg("assistant")];
    expect(
      recentInputMessages(input, { ...defaults, agentResultsFiltered: true })
    ).toEqual([]);
  });

  it("returns an empty list for empty input", () => {
    expect(recentInputMessages([], defaults)).toEqual([]);
  });
});

// Multi-Agent V2 fork boundary: a forked child's first call contains the
// parent's entire context as user/system messages (no assistant/tool message
// to stop at), so the walk-back degenerates to "everything is recent". The
// agent_message-derived user message is the real turn boundary.
describe("recentInputMessages (Multi-Agent V2 fork boundary)", () => {
  it("starts at the agent_message when the walk would consume the whole input", () => {
    const handoff = handoffMsg();
    const input = [
      msg("system"),
      msg("user", "parent task"),
      msg("user", "parent context"),
      msg("system", "fork-injected instructions"),
      msg("system", "fork-injected instructions"),
      handoff,
    ];
    expect(recentInputMessages(input, defaults)).toEqual([handoff]);
  });

  it("starts at the last agent_message when several are present", () => {
    const latest = handoffMsg("Agent message from /root:\nfollowup");
    const input = [
      msg("system"),
      handoffMsg("Agent message from /root:\nspawn task"),
      msg("system"),
      latest,
    ];
    expect(recentInputMessages(input, defaults)).toEqual([latest]);
  });

  it("keeps messages after the last agent_message", () => {
    const handoff = handoffMsg();
    const followup = msg("user", "notification");
    const input = [msg("system"), msg("user"), handoff, followup];
    expect(recentInputMessages(input, defaults)).toEqual([handoff, followup]);
  });

  it("does not trim when an assistant message bounded the walk", () => {
    // parent-style input: the walk already stops at the assistant message, so
    // the panel is unchanged even though an agent_message is present
    const handoff = handoffMsg("Agent message from /root/write_primes:\ndone");
    const notification = msg("user", "wait result");
    const input = [msg("system"), msg("assistant"), handoff, notification];
    expect(recentInputMessages(input, defaults)).toEqual([
      handoff,
      notification,
    ]);
  });

  it("does not trim all-user/system input without agent_messages (V1 forks)", () => {
    const input = [msg("system"), msg("user"), msg("user"), msg("user")];
    expect(recentInputMessages(input, defaults)).toEqual(input);
  });

  it("ignores agent_message payloads on non-user messages", () => {
    const sys = testSystemMessage({
      id: `m${nextId++}`,
      content: [{ type: "text", text: "x", internal: { agent_message: {} } }],
    });
    const input = [msg("system"), sys, msg("user")];
    expect(recentInputMessages(input, defaults)).toEqual(input);
  });
});
