import { describe, expect, it } from "vitest";

import type { Event } from "@tsmono/inspect-common/types";

import { messagesFromEvents } from "./messagesFromEvents";

const makeModelEvent = (opts: {
  error?: string;
  inputId?: string;
  outputId?: string;
}): Event =>
  ({
    event: "model",
    error: opts.error ?? null,
    input: opts.inputId
      ? [{ id: opts.inputId, role: "user", content: "hello", source: null }]
      : [],
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
});
