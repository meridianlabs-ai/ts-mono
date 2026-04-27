import { describe, expect, it } from "vitest";

import type { ChatMessage, Event } from "@tsmono/inspect-common/types";

import { messagesFromEvents } from "./messagesFromEvents";

const makeModelEvent = (opts: {
  error?: string;
  input?: ChatMessage[];
  inputId?: string;
  outputId?: string;
}): Event =>
  ({
    event: "model",
    error: opts.error ?? null,
    input:
      opts.input ??
      (opts.inputId
        ? [{ id: opts.inputId, role: "user", content: "hello", source: null }]
        : []),
    output: {
      choices: [
        {
          message: {
            id: opts.outputId ?? null,
            role: "assistant",
            content: "response",
            source: "generate",
          },
        },
      ],
    },
  }) as unknown as Event;

const userMsg = (id: string): ChatMessage =>
  ({ id, role: "user", content: "u", source: null }) as unknown as ChatMessage;
const assistantMsg = (id: string): ChatMessage =>
  ({
    id,
    role: "assistant",
    content: "a",
    source: "generate",
  }) as unknown as ChatMessage;
const toolMsg = (id: string): ChatMessage =>
  ({
    id,
    role: "tool",
    content: "t",
    source: null,
  }) as unknown as ChatMessage;

describe("messagesFromEvents", () => {
  it("returns messages from successful model events", () => {
    const messages = messagesFromEvents([
      makeModelEvent({ inputId: "msg-1", outputId: "msg-2" }),
    ]);
    expect(messages).toHaveLength(2);
    expect(messages[0]!.id).toBe("msg-1");
    expect(messages[1]!.id).toBe("msg-2");
  });

  it("skips model events with error set", () => {
    const messages = messagesFromEvents([
      makeModelEvent({
        error: "429 rate limit",
        inputId: "msg-1",
        outputId: "msg-err",
      }),
      makeModelEvent({ inputId: "msg-1", outputId: "msg-2" }),
    ]);
    expect(messages).toHaveLength(2);
    expect(messages[0]!.id).toBe("msg-1");
    expect(messages[1]!.id).toBe("msg-2");
  });

  it("includes the latest event's output when not yet folded into a later input", () => {
    const events = [
      makeModelEvent({
        input: [userMsg("u1")],
        outputId: "a1",
      }),
    ];
    const messages = messagesFromEvents(events);
    expect(messages.map((m) => m.id)).toEqual(["u1", "a1"]);
  });

  it("returns [] for an empty event stream", () => {
    expect(messagesFromEvents([])).toEqual([]);
  });

  it("returns [] when every model event has an error", () => {
    const events = [
      makeModelEvent({
        error: "429 rate limit",
        inputId: "msg-1",
        outputId: "msg-err-1",
      }),
      makeModelEvent({
        error: "500 server error",
        inputId: "msg-1",
        outputId: "msg-err-2",
      }),
    ];
    expect(messagesFromEvents(events)).toEqual([]);
  });

  it("interleaves tool results with their assistants when a later event folds them in", () => {
    // Multiple model events produce tool-calling assistants without their
    // tool results yet folded into subsequent inputs. A late event finally
    // arrives with all the tool results interleaved. Each tool result must
    // slot in immediately after the assistant whose call it answered.
    const events = [
      makeModelEvent({ input: [userMsg("u1")], outputId: "a1" }),
      makeModelEvent({
        input: [userMsg("u1"), assistantMsg("a1")],
        outputId: "a2",
      }),
      makeModelEvent({
        input: [userMsg("u1"), assistantMsg("a1"), assistantMsg("a2")],
        outputId: "a3",
      }),
      makeModelEvent({
        input: [
          userMsg("u1"),
          assistantMsg("a1"),
          toolMsg("t1"),
          assistantMsg("a2"),
          toolMsg("t2"),
          assistantMsg("a3"),
          toolMsg("t3"),
        ],
        outputId: "a4",
      }),
    ];

    const messages = messagesFromEvents(events);
    expect(messages.map((m) => m.id)).toEqual([
      "u1",
      "a1",
      "t1",
      "a2",
      "t2",
      "a3",
      "t3",
      "a4",
    ]);
  });

  it("preserves pre-compaction messages when later inputs are compacted", () => {
    // After compaction the next model event's input is a shortened summary
    // view that omits earlier messages. Those earlier messages must still
    // be visible, with the new compaction summary slotted in after them.
    const events = [
      makeModelEvent({
        input: [userMsg("u1"), userMsg("u2"), assistantMsg("a1")],
        outputId: "a2",
      }),
      makeModelEvent({
        input: [userMsg("summary"), assistantMsg("a2")],
        outputId: "a3",
      }),
    ];

    const messages = messagesFromEvents(events);
    expect(messages.map((m) => m.id)).toEqual([
      "u1",
      "u2",
      "a1",
      "a2",
      "summary",
      "a3",
    ]);
  });

  it("ignores duplicate ids within a single event's input", () => {
    // A duplicate input id would otherwise re-anchor the cursor backwards
    // and corrupt the ordering of subsequent new messages in the same walk.
    const events = [
      makeModelEvent({
        input: [
          userMsg("u1"),
          assistantMsg("a1"),
          userMsg("u1"),
          toolMsg("t1"),
        ],
        outputId: "a2",
      }),
    ];
    expect(messagesFromEvents(events).map((m) => m.id)).toEqual([
      "u1",
      "a1",
      "t1",
      "a2",
    ]);
  });

  it("places intermediate-output assistants between their event's neighbors", () => {
    // Two events share the same input, the second produces an extra
    // assistant. A later event has new tool/user messages folded in.
    // The intermediate assistant slots between its event's last input
    // anchor (u2) and its successor in the next event's input.
    const events = [
      makeModelEvent({
        input: [userMsg("u1"), userMsg("u2")],
        outputId: "a1",
      }),
      makeModelEvent({
        input: [userMsg("u1"), userMsg("u2")],
        outputId: "a2",
      }),
      makeModelEvent({
        input: [
          userMsg("u1"),
          userMsg("u2"),
          assistantMsg("a1"),
          toolMsg("t1"),
          userMsg("u3"),
        ],
        outputId: "a3",
      }),
    ];

    const messages = messagesFromEvents(events);
    expect(messages.map((m) => m.id)).toEqual([
      "u1",
      "u2",
      "a1",
      "t1",
      "u3",
      "a2",
      "a3",
    ]);
  });
});
