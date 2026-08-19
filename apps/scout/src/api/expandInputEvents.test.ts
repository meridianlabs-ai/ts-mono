import { describe, expect, it } from "vitest";

import { expandInputEvents } from "./expandInputEvents";

describe("expandInputEvents", () => {
  it("resolves attachment refs carried in input_data", () => {
    const id = "c".repeat(32);
    const input = {
      transcript_id: "t1",
      messages: [{ id: "m1", role: "user", content: `attachment://${id}` }],
      events: [],
    };
    const result = expandInputEvents(input as never, "transcript", {
      messages: [],
      calls: [],
      attachments: { [id]: "hello" },
    }) as unknown as typeof input;

    expect(result.messages).toEqual([
      { id: "m1", role: "user", content: "hello" },
    ]);
  });
});
