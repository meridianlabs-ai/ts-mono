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

  // Wire data of an older vintage than the generated types admit: a pre-2025
  // writer omits working_start, and scout renders these through the shared
  // transcript components, which read it unguarded.
  const legacyStepEvent = { event: "step", action: "begin", name: "solve" };
  const legacyTranscript = {
    transcript_id: "t1",
    messages: [],
    events: [legacyStepEvent],
    timelines: [],
    metadata: {},
  };
  const legacyModelEvent = { event: "model", timestamp: "t", model: "m" };

  it("normalizes legacy events missing type-required fields (#555)", () => {
    const result = expandInputEvents(legacyTranscript, "transcript", {
      messages: [],
      calls: [],
    });

    expect(result).toMatchObject({
      events: [{ event: "step", working_start: 0, timestamp: "" }],
    });
  });

  it("normalizes legacy transcript events when input_data is absent", () => {
    // Old scans predate the input_data column entirely — the server sends
    // null — and their events are exactly the ones needing fills.
    const result = expandInputEvents(legacyTranscript, "transcript", null);

    expect(result).toMatchObject({
      events: [{ event: "step", working_start: 0, timestamp: "" }],
    });
  });

  it("normalizes bare event-list inputs when input_data is absent", () => {
    const result = expandInputEvents([legacyModelEvent], "events", null);

    expect(result).toMatchObject([
      { event: "model", working_start: 0, config: {}, tools: [] },
    ]);
  });

  it("normalizes single-event inputs", () => {
    const result = expandInputEvents(legacyModelEvent, "event", null);

    expect(result).toMatchObject({
      event: "model",
      working_start: 0,
      config: {},
      tools: [],
    });
  });

  it("normalizes bare event-list inputs too", () => {
    const result = expandInputEvents([legacyModelEvent], "events", {
      messages: [],
      calls: [],
    });

    expect(result).toMatchObject([
      { event: "model", working_start: 0, config: {}, tools: [] },
    ]);
  });
});
