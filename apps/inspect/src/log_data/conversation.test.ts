import { describe, expect, it } from "vitest";

import { ChatMessage } from "@tsmono/inspect-common/types";

import { inMemoryConversation } from "./conversation";

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
