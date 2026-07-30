import { describe, expect, it } from "vitest";

import { ChatMessage } from "@tsmono/inspect-common/types";

import { conversationRanges, inMemoryConversation } from "./conversation";

const message = (id: string): ChatMessage => ({
  id,
  role: "user",
  content: id,
});

const messages = ["m-0", "m-1", "m-2", "m-3", "m-4"].map(message);

describe("inMemoryConversation", () => {
  it("reports the conversation length synchronously", () => {
    expect(inMemoryConversation(messages).messageCount).toBe(5);
    expect(inMemoryConversation([]).messageCount).toBe(0);
  });

  it("serves half-open windows by conversation position", async () => {
    const conversation = inMemoryConversation(messages);
    await expect(conversation.getMessages(1, 4)).resolves.toEqual(
      messages.slice(1, 4)
    );
    await expect(conversation.getMessages(0, 5)).resolves.toEqual(messages);
    await expect(conversation.getMessages(2, 2)).resolves.toEqual([]);
  });

  it("clamps out-of-range bounds instead of failing", async () => {
    const conversation = inMemoryConversation(messages);
    await expect(conversation.getMessages(-3, 2)).resolves.toEqual(
      messages.slice(0, 2)
    );
    await expect(conversation.getMessages(3, 99)).resolves.toEqual(
      messages.slice(3)
    );
    await expect(conversation.getMessages(99, 120)).resolves.toEqual([]);
    await expect(conversation.getMessages(-5, -1)).resolves.toEqual([]);
  });

  it("handles an empty conversation", async () => {
    await expect(inMemoryConversation([]).getMessages(0, 10)).resolves.toEqual(
      []
    );
  });
});

describe("conversationRanges", () => {
  // widths 3, 2, 5 — conversation positions 0-2, 3-4, 5-9
  const refs: [number, number][] = [
    [10, 13],
    [20, 22],
    [30, 35],
  ];

  it("maps a window within one ref to a single offset range", () => {
    expect(conversationRanges(refs, 1, 3)).toEqual([[11, 13]]);
    expect(conversationRanges(refs, 5, 8)).toEqual([[30, 33]]);
  });

  it("splits windows crossing ref boundaries", () => {
    expect(conversationRanges(refs, 2, 6)).toEqual([
      [12, 13],
      [20, 22],
      [30, 31],
    ]);
    expect(conversationRanges(refs, 0, 10)).toEqual(refs);
  });

  it("clamps out-of-range bounds", () => {
    expect(conversationRanges(refs, -5, 2)).toEqual([[10, 12]]);
    expect(conversationRanges(refs, 8, 99)).toEqual([[33, 35]]);
    expect(conversationRanges(refs, 10, 20)).toEqual([]);
    expect(conversationRanges(refs, 4, 4)).toEqual([]);
  });

  it("skips zero-width refs", () => {
    const gappy: [number, number][] = [
      [10, 12],
      [15, 15],
      [20, 22],
    ];
    expect(conversationRanges(gappy, 1, 3)).toEqual([
      [11, 12],
      [20, 21],
    ]);
  });

  it("handles empty refs", () => {
    expect(conversationRanges([], 0, 10)).toEqual([]);
  });
});
