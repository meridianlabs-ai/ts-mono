import { describe, expect, it } from "vitest";

import type { ChatMessage, ModelEvent } from "@tsmono/inspect-common/types";

import { summaryInputMessages } from "./modelSummaryMessages";

const msg = (m: Record<string, unknown>): ChatMessage =>
  m as unknown as ChatMessage;

const modelEvent = (
  input: ChatMessage[],
  extra: Record<string, unknown> = {}
): ModelEvent =>
  ({
    event: "model",
    model: "test/model",
    input,
    output: { choices: [] },
    ...extra,
  }) as unknown as ModelEvent;

describe("summaryInputMessages", () => {
  it("takes the trailing run of user and system messages", () => {
    const event = modelEvent([
      msg({ role: "system", content: "task prompt" }),
      msg({ role: "user", content: "old turn" }),
      msg({ role: "assistant", content: "old answer" }),
      msg({ role: "tool", content: "tool result" }),
      msg({ role: "user", content: "current turn" }),
    ]);
    expect(summaryInputMessages(event).map((m) => m.content)).toEqual([
      "current turn",
    ]);
  });

  it("stops the backward walk at a user message carrying tool_call_id", () => {
    const event = modelEvent([
      msg({ role: "user", content: "real prompt" }),
      msg({ role: "user", content: "tool reply", tool_call_id: "call-1" }),
    ]);
    expect(summaryInputMessages(event)).toEqual([]);
  });

  // Surprising, and deliberately so — see the `slice(-1)` note in
  // modelSummaryMessages.ts.
  it("returns only the trailing assistant message, not earlier messages", () => {
    const event = modelEvent([
      msg({ role: "assistant", content: "older answer" }),
      msg({ role: "user", content: "prompt" }),
      msg({ role: "assistant", content: "compaction summary" }),
    ]);
    expect(summaryInputMessages(event).map((m) => m.content)).toEqual([
      "compaction summary",
    ]);
  });

  it("returns nothing when agent results have been filtered from input", () => {
    const event = modelEvent(
      [
        msg({ role: "user", content: "prompt" }),
        msg({ role: "assistant", content: "answer" }),
      ],
      { agentResultsFiltered: true }
    );
    expect(summaryInputMessages(event)).toEqual([]);
  });

  it("excludes tool messages by default", () => {
    const event = modelEvent([
      msg({ role: "user", content: "prompt" }),
      msg({ role: "tool", content: "tool result" }),
    ]);
    expect(summaryInputMessages(event)).toEqual([]);
  });

  it("includes tool messages under includeToolMessages", () => {
    const event = modelEvent([
      msg({ role: "user", content: "prompt" }),
      msg({ role: "tool", content: "tool result" }),
    ]);
    const out = summaryInputMessages(event, { includeToolMessages: true });
    expect(out.map((m) => m.content)).toEqual(["prompt", "tool result"]);
  });
});
