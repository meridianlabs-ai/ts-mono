import { describe, expect, it } from "vitest";

import type { ScannerInputResponse, Transcript } from "../types/api-types";

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

  it("normalizes legacy events missing type-required fields (#555)", () => {
    // A pre-2025 writer omits working_start; scout renders these through the
    // shared transcript components, which read it unguarded.
    const legacyEvent = { event: "step", action: "begin", name: "solve" };
    const input: Transcript = {
      transcript_id: "t1",
      messages: [],
      // Wire data of an older vintage than the generated type admits.
      events: [legacyEvent] as unknown as Transcript["events"],
      timelines: [],
      metadata: {},
    };

    const result = expandInputEvents(input, "transcript", {
      messages: [],
      calls: [],
    }) as Transcript;

    expect(result.events[0]).toMatchObject({
      event: "step",
      working_start: 0,
      timestamp: "",
    });
  });

  it("normalizes legacy transcript events when input_data is absent", () => {
    // Old scans predate the input_data column entirely — the server sends
    // null — and their events are exactly the ones needing fills.
    const legacyEvent = { event: "step", action: "begin", name: "solve" };
    const input: Transcript = {
      transcript_id: "t1",
      messages: [],
      // Wire data of an older vintage than the generated type admits.
      events: [legacyEvent] as unknown as Transcript["events"],
      timelines: [],
      metadata: {},
    };

    const result = expandInputEvents(input, "transcript", null) as Transcript;

    expect(result.events[0]).toMatchObject({
      event: "step",
      working_start: 0,
      timestamp: "",
    });
  });

  it("normalizes bare event-list inputs when input_data is absent", () => {
    const legacyEvents = [
      { event: "model", timestamp: "t", model: "m" },
    ] as unknown as ScannerInputResponse["input"];

    const result = expandInputEvents(legacyEvents, "events", null);

    expect(result).toMatchObject([
      { event: "model", working_start: 0, config: {}, tools: [] },
    ]);
  });

  it("normalizes bare event-list inputs too", () => {
    // Wire data of an older vintage than the generated type admits.
    const legacyEvents = [
      { event: "model", timestamp: "t", model: "m" },
    ] as unknown as ScannerInputResponse["input"];
    const result = expandInputEvents(legacyEvents, "events", {
      messages: [],
      calls: [],
    });

    expect(result).toMatchObject([
      { event: "model", working_start: 0, config: {}, tools: [] },
    ]);
  });
});
