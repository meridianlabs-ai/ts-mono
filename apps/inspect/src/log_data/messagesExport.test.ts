import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useMessagesExport } from "./messagesExport";
import { type EvalSampleData } from "./sampleData";
import {
  testHandle as handle,
  testMessages as makeMessages,
  makeWrapper,
  sequenceReaderOver,
  settledData,
  testChunkedSample,
} from "./testFixtures";

describe("useMessagesExport", () => {
  it("exports a settled monolith conversation", async () => {
    const sampleData = settledData(makeMessages(3));
    const { result } = renderHook(() => useMessagesExport(handle, sampleData), {
      wrapper: makeWrapper(),
    });

    const text = await result.current!();
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
    const { result } = renderHook(() => useMessagesExport(handle, sampleData), {
      wrapper: makeWrapper(),
    });

    expect(result.current).toBeUndefined();
  });

  it("hydrates a chunked conversation on demand, once", async () => {
    const reader = sequenceReaderOver(makeMessages(4));
    const getRange = vi.spyOn(reader, "getRange");
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
    const { result } = renderHook(() => useMessagesExport(handle, sampleData), {
      wrapper: makeWrapper(),
    });

    // export works without the Messages tab ever having been opened
    const text = await result.current!();
    expect(text).toContain("message 0");
    expect(text).toContain("message 3");

    // a second export reuses the resident hydration
    await result.current!();
    expect(getRange).toHaveBeenCalledTimes(1);
  });
});
