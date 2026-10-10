import { describe, expect, it } from "vitest";

import {
  testAssistantMessage,
  testSystemMessage,
  testToolCall,
  testToolMessage,
  testUserMessage,
} from "@tsmono/inspect-common/testing";

import { kitchenSink } from "../testFixtures";

import {
  buildSelectableMessageIndex,
  resolveSelectedMessageIds,
  resolveSelectedMessages,
} from "./messageSelection";

describe("buildSelectableMessageIndex", () => {
  it("keys every rendered row by message id, system row first", () => {
    const index = buildSelectableMessageIndex(kitchenSink);
    expect([...index.keys()]).toEqual([
      "sys-message-6815A84B062A",
      "msg-1",
      "msg-2",
      "msg-7",
      "msg-8",
      "msg-9",
      "msg-11",
    ]);
  });

  it("folds a row's tool messages under their head message", () => {
    const index = buildSelectableMessageIndex(kitchenSink);
    const row = index.get("msg-2");
    expect(row?.length).toBe(3);
    expect(row?.[0]?.role).toBe("assistant");
    expect(row?.[1]?.role).toBe("tool");
    expect(row?.[2]?.role).toBe("tool");
  });

  it("resolves the merged system row to the original system messages", () => {
    const index = buildSelectableMessageIndex(kitchenSink);
    const row = index.get("sys-message-6815A84B062A");
    expect(row?.map((message) => message.content)).toEqual([
      "be helpful",
      "mid-conversation system",
    ]);
  });

  it("never keys tool messages on their own", () => {
    const index = buildSelectableMessageIndex([
      testAssistantMessage({
        id: "a1",
        content: "",
        tool_calls: [testToolCall({ id: "c-1", function: "bash" })],
      }),
      testToolMessage({ id: "t1", content: "ok", tool_call_id: "c-1" }),
    ]);
    expect([...index.keys()]).toEqual(["a1"]);
    expect(index.get("a1")?.length).toBe(2);
  });

  it("prefers real ids over minted ones", () => {
    const index = buildSelectableMessageIndex([
      testSystemMessage({ id: "s1", content: "be helpful" }),
      testUserMessage({ id: "u1", content: "hi" }),
      testAssistantMessage({ id: "a1", content: "hello" }),
    ]);
    expect([...index.keys()]).toEqual(["sys-message-6815A84B062A", "u1", "a1"]);
  });
});

describe("resolveSelectedMessages", () => {
  it("exports original id-less messages and folded tool results", () => {
    const assistant = testAssistantMessage({
      id: undefined,
      content: "",
      tool_calls: [testToolCall({ id: "c-1", function: "bash" })],
    });
    const tool = testToolMessage({
      id: undefined,
      content: "ok",
      tool_call_id: "c-1",
    });
    const messages = resolveSelectedMessages(
      buildSelectableMessageIndex([assistant, tool]),
      new Set(["msg-0"])
    );
    expect(messages).toEqual([assistant, tool]);
    expect(messages[0]).toBe(assistant);
    expect(messages[1]).toBe(tool);
    expect(messages[0]?.id).toBeUndefined();
    expect(messages[1]?.id).toBeUndefined();
  });

  const index = buildSelectableMessageIndex(kitchenSink);

  it("returns the selected rows in chat order, heads with their tools", () => {
    const messages = resolveSelectedMessages(
      index,
      new Set(["msg-9", "msg-1", "nope"])
    );
    expect(messages.map((message) => message.content)).toEqual([
      "hi",
      "using a tool",
      "ok",
    ]);
  });

  it("returns nothing for an empty selection", () => {
    expect(resolveSelectedMessages(index, new Set())).toEqual([]);
  });
});

describe("resolveSelectedMessageIds", () => {
  const index = buildSelectableMessageIndex(kitchenSink);

  it("returns the resolving ids in chat order, ignoring unknown ids", () => {
    expect(
      resolveSelectedMessageIds(index, new Set(["msg-11", "nope", "msg-1"]))
    ).toEqual(["msg-1", "msg-11"]);
  });
});
