import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SampleHandle } from "../app/types";

import { type EvalSampleData } from "./sampleData";
import { useSampleMessages } from "./sampleMessages";
import {
  failingSequenceReader,
  testHandle as handle,
  testMessages as makeMessages,
  makeWrapper,
  testModelEvent as modelEvent,
  settledData,
  testChunkedSample,
} from "./testFixtures";

describe("useSampleMessages", () => {
  it("reads a settled sample's rows through the seam", async () => {
    const sampleData = settledData(makeMessages(1200));
    const { result } = renderHook(
      () => useSampleMessages(handle, sampleData, true, false),
      { wrapper: makeWrapper() }
    );

    // the read is asynchronous: a loading affordance covers the gap
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeUndefined();

    await waitFor(() => expect(result.current.data).toHaveLength(1200));
    expect(result.current.loading).toBe(false);
    expect(result.current.data?.[0]?.startNumber).toBe(1);
  });

  it("reports loading during a monolith sample fetch, never 'No messages'", () => {
    const sampleData: EvalSampleData = {
      sample: undefined,
      status: "loading",
      error: undefined,
      running: [],
      eventsCleared: false,
      backfilling: false,
    };
    const { result } = renderHook(
      () => useSampleMessages(handle, sampleData, true, false),
      { wrapper: makeWrapper() }
    );

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeUndefined();
  });

  it("derives streaming rows from the event feed with no source", () => {
    const sampleData: EvalSampleData = {
      sample: undefined,
      status: "loading",
      error: undefined,
      running: [modelEvent("m-in", "m-out")],
      eventsCleared: false,
      backfilling: false,
    };
    const { result } = renderHook(
      () => useSampleMessages(handle, sampleData, true, true),
      { wrapper: makeWrapper() }
    );

    expect(result.current.loading).toBe(false);
    expect(result.current.data?.map((r) => r.resolved.message.id)).toEqual([
      "m-in",
      "m-out",
    ]);
  });

  it("keeps a pre-first-poll live sample on the waiting affordance", () => {
    const sampleData: EvalSampleData = {
      sample: undefined,
      status: "loading",
      error: undefined,
      running: [],
      eventsCleared: false,
      backfilling: false,
    };
    const { result } = renderHook(
      () => useSampleMessages(handle, sampleData, true, true),
      { wrapper: makeWrapper() }
    );

    // running gates loading off: the view renders "Waiting for messages"
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toHaveLength(0);
  });

  it("swaps the streaming feed for settled rows without an empty frame", async () => {
    // the live-finish handoff: settledSampleData clears running events on
    // the same render the sample body appears, and the settled read is
    // asynchronous — the last streaming rows bridge its pending frames (an
    // empty frame would unmount the list and lose its scroll handoff)
    const streamingData: EvalSampleData = {
      sample: undefined,
      status: "streaming",
      error: undefined,
      running: [modelEvent("m-in", "m-out")],
      eventsCleared: false,
      backfilling: false,
    };
    const { result, rerender } = renderHook(
      ({ data, running }: { data: EvalSampleData; running: boolean }) =>
        useSampleMessages(handle, data, true, running),
      {
        wrapper: makeWrapper(),
        initialProps: { data: streamingData, running: true },
      }
    );
    expect(result.current.data).toHaveLength(2);

    rerender({ data: settledData(makeMessages(50)), running: false });
    // the bridge: streaming rows hold while the read is in flight
    expect(result.current.data).toHaveLength(2);
    expect(result.current.loading).toBe(false);

    await waitFor(() => expect(result.current.data).toHaveLength(50));
    expect(result.current.loading).toBe(false);
  });

  it("never bridges streaming rows across samples", async () => {
    const streamingData: EvalSampleData = {
      sample: undefined,
      status: "streaming",
      error: undefined,
      running: [modelEvent("m-in", "m-out")],
      eventsCleared: false,
      backfilling: false,
    };
    const other: SampleHandle = { logFile: "log.eval", id: "s2", epoch: 1 };
    const { result, rerender } = renderHook(
      ({
        h,
        data,
        running,
      }: {
        h: SampleHandle;
        data: EvalSampleData;
        running: boolean;
      }) => useSampleMessages(h, data, true, running),
      {
        wrapper: makeWrapper(),
        initialProps: { h: handle, data: streamingData, running: true },
      }
    );
    expect(result.current.data).toHaveLength(2);

    // navigating mid-stream to a settled sample: the previous sample's
    // streaming rows must not cover the new sample's read
    rerender({ h: other, data: settledData(makeMessages(5)), running: false });
    expect(result.current.data).toBeUndefined();
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.data).toHaveLength(5));
  });

  it("defers all folding until the Messages tab first opens, then latches", async () => {
    const sampleData = settledData(makeMessages(10));
    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) =>
        useSampleMessages(handle, sampleData, active, false),
      { wrapper: makeWrapper(), initialProps: { active: false } }
    );

    // inactive: no read
    expect(result.current.data).toHaveLength(0);

    rerender({ active: true });
    await waitFor(() => expect(result.current.data).toHaveLength(10));

    // latched: switching away keeps the rows resident
    rerender({ active: false });
    expect(result.current.data).toHaveLength(10);
  });

  it("keeps the streaming fold off while the tab has never been open", () => {
    const streamingData: EvalSampleData = {
      sample: undefined,
      status: "streaming",
      error: undefined,
      running: [modelEvent("m-in", "m-out")],
      eventsCleared: false,
      backfilling: false,
    };
    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) =>
        useSampleMessages(handle, streamingData, active, true),
      { wrapper: makeWrapper(), initialProps: { active: false } }
    );

    expect(result.current.data).toHaveLength(0);

    rerender({ active: true });
    expect(result.current.data).toHaveLength(2);
  });

  it("stops the streaming fold when the tab is hidden, latch or not", () => {
    const streamingData: EvalSampleData = {
      sample: undefined,
      status: "streaming",
      error: undefined,
      running: [modelEvent("m-in", "m-out")],
      eventsCleared: false,
      backfilling: false,
    };
    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) =>
        useSampleMessages(handle, streamingData, active, true),
      { wrapper: makeWrapper(), initialProps: { active: true } }
    );
    expect(result.current.data).toHaveLength(2);

    // hidden mid-stream: the per-poll refold must not keep running (the
    // list is unmounted); returning rebuilds from the events
    rerender({ active: false });
    expect(result.current.data).toHaveLength(0);

    rerender({ active: true });
    expect(result.current.data).toHaveLength(2);
  });

  it("resets the latch when the sample changes", async () => {
    const sampleData = settledData(makeMessages(4));
    const other: SampleHandle = { logFile: "log.eval", id: "s2", epoch: 1 };
    const { result, rerender } = renderHook(
      ({ h, active }: { h: SampleHandle; active: boolean }) =>
        useSampleMessages(h, sampleData, active, false),
      { wrapper: makeWrapper(), initialProps: { h: handle, active: true } }
    );
    await waitFor(() => expect(result.current.data).toHaveLength(4));

    // a different sample arrives with the tab closed: no read until opened
    rerender({ h: other, active: false });
    expect(result.current.data).toHaveLength(0);

    // returning to the previously-activated sample must NOT re-latch: the
    // hook mounts unkeyed, so a stale latch would read at sample open
    rerender({ h: handle, active: false });
    expect(result.current.data).toHaveLength(0);

    // re-opening serves the cached rows synchronously
    rerender({ h: handle, active: true });
    expect(result.current.data).toHaveLength(4);
  });

  it("surfaces a chunked hydration failure instead of 'No messages'", async () => {
    const failingChunked = testChunkedSample(
      failingSequenceReader(new Error("boom")),
      [[0, 2]]
    );
    const sampleData: EvalSampleData = {
      sample: undefined,
      status: "ok",
      error: undefined,
      running: [],
      eventsCleared: false,
      backfilling: false,
      chunked: failingChunked,
    };
    const { result } = renderHook(
      () => useSampleMessages(handle, sampleData, true, false),
      { wrapper: makeWrapper() }
    );

    await waitFor(() => {
      expect(result.current.error).toBeInstanceOf(Error);
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeUndefined();
  });

  it("handles an empty settled conversation", async () => {
    const sampleData = settledData([]);
    const { result } = renderHook(
      () => useSampleMessages(handle, sampleData, true, false),
      { wrapper: makeWrapper() }
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toHaveLength(0);
    expect(result.current.error).toBeUndefined();
  });
});
