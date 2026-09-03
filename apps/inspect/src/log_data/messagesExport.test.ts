import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChunkByteStore, SequenceReader } from "./chunked";
import { useMessagesExport } from "./messagesExport";
import { type EvalSampleData } from "./sampleData";
import {
  testMessages as makeMessages,
  makeWrapper,
  settledData,
  testChunkedSample,
} from "./testFixtures";

const encoder = new TextEncoder();

describe("useMessagesExport", () => {
  it("exports a settled monolith conversation", async () => {
    const sampleData = settledData(makeMessages(3));
    const { result } = renderHook(() => useMessagesExport(sampleData), {
      wrapper: makeWrapper(),
    });

    const text = (await result.current!()).join("");
    expect(text).toContain("message 0");
    expect(text).toContain("message 2");
  });

  it("is undefined while streaming or loading — nothing settled to export", () => {
    const sampleData: EvalSampleData = {
      sample: undefined,
      status: "streaming",
      error: undefined,
      running: [],
      eventsCleared: false,
      backfilling: false,
    };
    const { result } = renderHook(() => useMessagesExport(sampleData), {
      wrapper: makeWrapper(),
    });

    expect(result.current).toBeUndefined();
  });

  it("streams a chunked conversation without re-fetching chunk bytes", async () => {
    const messages = makeMessages(4);
    let byteReads = 0;
    const reader = new SequenceReader<(typeof messages)[number]>(
      new ChunkByteStore({
        readFile: () => {
          byteReads++;
          return Promise.resolve(encoder.encode(JSON.stringify(messages)));
        },
      }),
      (start) => `chunk/${start}.json`,
      [0],
      messages.length
    );
    const chunked = testChunkedSample(reader);
    const sampleData: EvalSampleData = {
      sample: undefined,
      status: "ok",
      error: undefined,
      running: [],
      eventsCleared: false,
      backfilling: false,
      chunked,
    };
    const { result } = renderHook(() => useMessagesExport(sampleData), {
      wrapper: makeWrapper(),
    });

    // export works without the Messages tab ever having been opened
    const text = (await result.current!()).join("");
    expect(text).toContain("message 0");
    expect(text).toContain("message 3");

    // a second export reads through the shared chunk caches
    await result.current!();
    expect(byteReads).toBe(1);
  });
});
