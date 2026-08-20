import { describe, expect, it } from "vitest";

import type { Transcript } from "../types/api-types";

import { expandInputEvents } from "./expandInputEvents";

describe("expandInputEvents", () => {
  it("resolves attachment refs carried in input_data", () => {
    const id = "c".repeat(32);
    const input: Transcript = {
      transcript_id: "t1",
      messages: [{ id: "m1", role: "user", content: `attachment://${id}` }],
      events: [],
      timelines: [],
      metadata: {},
    };

    const result = expandInputEvents(input, "transcript", {
      messages: [],
      calls: [],
      attachments: { [id]: "hello" },
    });

    expect(result).toEqual({
      ...input,
      messages: [{ id: "m1", role: "user", content: "hello" }],
    });
  });
});
