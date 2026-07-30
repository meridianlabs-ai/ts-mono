import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { ChatMessage, EvalSample, Event } from "@tsmono/inspect-common/types";

import { SampleHandle } from "../app/types";

import { type ChunkedSample } from "./chunked";
import { type EvalSampleData } from "./sampleData";
import { useSampleMessages } from "./sampleMessages";

const logDir = "logs";
const handle: SampleHandle = { logFile: "log.eval", id: "s1", epoch: 1 };

const makeMessages = (count: number): ChatMessage[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `m-${i}`,
    role: "user",
    content: `message ${i}`,
  })) as unknown as ChatMessage[];

const settledData = (messages: ChatMessage[]): EvalSampleData => ({
  sample: { messages } as EvalSample,
  status: "ok",
  error: undefined,
  running: [],
  eventsCleared: false,
  backfilling: false,
});

const modelEvent = (inputId: string, outputId: string): Event =>
  ({
    event: "model",
    error: null,
    input: [{ id: inputId, role: "user", content: "hello", source: null }],
    output: {
      choices: [
        {
          message: {
            id: outputId,
            role: "assistant",
            content: "response",
            source: "generate",
          },
        },
      ],
    },
  }) as unknown as Event;

const makeWrapper = (client: QueryClient = new QueryClient()) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };

describe("useSampleMessages", () => {
  it("serves a settled sample's rows synchronously through the seam", () => {
    const sampleData = settledData(makeMessages(1200));
    const { result } = renderHook(
      () => useSampleMessages(logDir, handle, sampleData, true, false),
      { wrapper: makeWrapper() }
    );

    expect(result.current.loading).toBe(false);
    expect(result.current.rows).toHaveLength(1200);
    expect(result.current.rows[0]?.startNumber).toBe(1);
    expect(result.current.source).toBeDefined();
  });

  it("exports the settled conversation's text", async () => {
    const sampleData = settledData(makeMessages(3));
    const { result } = renderHook(
      () => useSampleMessages(logDir, handle, sampleData, true, false),
      { wrapper: makeWrapper() }
    );

    const text = await result.current.source!.exportText();
    expect(text).toContain("message 0");
    expect(text).toContain("message 2");
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
      () => useSampleMessages(logDir, handle, sampleData, true, false),
      { wrapper: makeWrapper() }
    );

    expect(result.current.loading).toBe(true);
    expect(result.current.rows).toHaveLength(0);
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
      () => useSampleMessages(logDir, handle, sampleData, true, true),
      { wrapper: makeWrapper() }
    );

    expect(result.current.loading).toBe(false);
    expect(result.current.rows.map((r) => r.resolved.message.id)).toEqual([
      "m-in",
      "m-out",
    ]);
    expect(result.current.source).toBeUndefined();
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
      () => useSampleMessages(logDir, handle, sampleData, true, true),
      { wrapper: makeWrapper() }
    );

    // running gates loading off: the view renders "Waiting for messages"
    expect(result.current.loading).toBe(false);
    expect(result.current.rows).toHaveLength(0);
  });

  it("swaps the streaming feed for settled rows without an empty frame", () => {
    // the live-finish handoff: settledSampleData clears running events on
    // the same render the sample body appears, so the settled rows must be
    // resident on that render — an empty frame would unmount the list
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
        useSampleMessages(logDir, handle, data, true, running),
      {
        wrapper: makeWrapper(),
        initialProps: { data: streamingData, running: true },
      }
    );
    expect(result.current.rows).toHaveLength(2);

    rerender({ data: settledData(makeMessages(50)), running: false });
    expect(result.current.rows).toHaveLength(50);
    expect(result.current.loading).toBe(false);
  });

  it("defers all folding until the Messages tab first opens, then latches", () => {
    const sampleData = settledData(makeMessages(10));
    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) =>
        useSampleMessages(logDir, handle, sampleData, active, false),
      { wrapper: makeWrapper(), initialProps: { active: false } }
    );

    // inactive: no fold — but the source (copy/download) exists
    expect(result.current.rows).toHaveLength(0);
    expect(result.current.source).toBeDefined();

    rerender({ active: true });
    expect(result.current.rows).toHaveLength(10);

    // latched: switching away keeps the rows resident
    rerender({ active: false });
    expect(result.current.rows).toHaveLength(10);
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
        useSampleMessages(logDir, handle, streamingData, active, true),
      { wrapper: makeWrapper(), initialProps: { active: false } }
    );

    expect(result.current.rows).toHaveLength(0);

    rerender({ active: true });
    expect(result.current.rows).toHaveLength(2);
  });

  it("resets the latch when the sample changes", () => {
    const sampleData = settledData(makeMessages(4));
    const other: SampleHandle = { logFile: "log.eval", id: "s2", epoch: 1 };
    const { result, rerender } = renderHook(
      ({ h, active }: { h: SampleHandle; active: boolean }) =>
        useSampleMessages(logDir, h, sampleData, active, false),
      { wrapper: makeWrapper(), initialProps: { h: handle, active: true } }
    );
    expect(result.current.rows).toHaveLength(4);

    // a different sample arrives with the tab closed: no fold until opened
    rerender({ h: other, active: false });
    expect(result.current.rows).toHaveLength(0);

    // returning to the previously-activated sample must NOT re-latch: the
    // hook mounts unkeyed, so a stale latch would fold at sample open
    rerender({ h: handle, active: false });
    expect(result.current.rows).toHaveLength(0);

    rerender({ h: handle, active: true });
    expect(result.current.rows).toHaveLength(4);
  });

  it("surfaces a chunked hydration failure instead of 'No messages'", async () => {
    const failingChunked = {
      shell: { id: "s1", epoch: 1, message_refs: [[0, 2]] },
      messages: { getRange: () => Promise.reject(new Error("boom")) },
    } as unknown as ChunkedSample;
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
      () => useSampleMessages(logDir, handle, sampleData, true, false),
      { wrapper: makeWrapper() }
    );

    await waitFor(() => {
      expect(result.current.error).toBeInstanceOf(Error);
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.rows).toHaveLength(0);
  });

  it("handles an empty settled conversation", () => {
    const sampleData = settledData([]);
    const { result } = renderHook(
      () => useSampleMessages(logDir, handle, sampleData, true, false),
      { wrapper: makeWrapper() }
    );

    expect(result.current.loading).toBe(false);
    expect(result.current.rows).toHaveLength(0);
  });
});
