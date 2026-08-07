import { describe, expect, it } from "vitest";

import type { ScannerInputResponse, Transcript } from "../types/api-types";

import { expandInputEvents } from "./expandInputEvents";

const HASH = "00000000000000000000000000000001";
const NESTED_HASH = "00000000000000000000000000000002";

type InputData = NonNullable<ScannerInputResponse["input_data"]>;

function inputData(overrides: Partial<InputData> = {}): InputData {
  return { messages: [], calls: [], ...overrides };
}

function transcript(overrides: Partial<Transcript> = {}): Transcript {
  return {
    transcript_id: "t1",
    messages: [],
    events: [],
    timelines: [],
    ...overrides,
  } as Transcript;
}

describe("expandInputEvents", () => {
  it("returns the input untouched when there is no input_data", () => {
    const input = transcript();
    expect(expandInputEvents(input, "transcript", null)).toBe(input);
  });

  it("resolves attachment refs in messages", () => {
    const input = transcript({
      messages: [
        { id: "m1", role: "user", content: `attachment://${HASH}` },
      ] as Transcript["messages"],
    });

    const result = expandInputEvents(
      input,
      "transcript",
      inputData({ attachments: { [HASH]: "the system prompt" } })
    ) as Transcript;

    expect(result.messages[0]).toMatchObject({ content: "the system prompt" });
  });

  it("resolves refs that only appear after pool expansion", () => {
    // The ref lives in a pooled message, so it is unreachable until
    // expandEvents has substituted the pool entry into the event.
    const input = transcript({
      events: [
        {
          event: "model",
          span_id: "s1",
          timestamp: "2026-01-01T00:00:00+00:00",
          working_start: 0,
          model: "m",
          input: [],
          input_refs: [[0, 1]],
          output: { model: "m", choices: [] },
        },
      ] as unknown as Transcript["events"],
    });

    const result = expandInputEvents(
      input,
      "transcript",
      inputData({
        messages: [
          { id: "p1", role: "system", content: `attachment://${NESTED_HASH}` },
        ] as InputData["messages"],
        attachments: { [NESTED_HASH]: "pooled content" },
      })
    ) as Transcript;

    expect(JSON.stringify(result.events)).toContain("pooled content");
    expect(JSON.stringify(result.events)).not.toContain("attachment://");
  });

  it("resolves refs in sample metadata", () => {
    const input = transcript({
      metadata: { sample_metadata: { note: `attachment://${HASH}` } },
    });

    const result = expandInputEvents(
      input,
      "transcript",
      inputData({ attachments: { [HASH]: "metadata value" } })
    ) as Transcript;

    expect(result.metadata).toMatchObject({
      sample_metadata: { note: "metadata value" },
    });
  });

  it("leaves refs alone when no attachments table is present", () => {
    const literal = `attachment://${HASH}`;
    const input = transcript({
      messages: [
        { id: "m1", role: "user", content: literal },
      ] as Transcript["messages"],
    });

    const result = expandInputEvents(
      input,
      "transcript",
      inputData()
    ) as Transcript;

    expect(result.messages[0]).toMatchObject({ content: literal });
  });

  it("resolves refs for the events input type", () => {
    const events = [
      {
        event: "info",
        span_id: "s1",
        timestamp: "2026-01-01T00:00:00+00:00",
        working_start: 0,
        data: `attachment://${HASH}`,
      },
    ] as unknown as ScannerInputResponse["input"];

    const result = expandInputEvents(
      events,
      "events",
      inputData({ attachments: { [HASH]: "info payload" } })
    );

    expect(JSON.stringify(result)).toContain("info payload");
  });
});
