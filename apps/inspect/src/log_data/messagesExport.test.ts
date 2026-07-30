import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { createElement, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { ChatMessage, EvalSample } from "@tsmono/inspect-common/types";

import { SampleHandle } from "../app/types";

import { type ChunkedSample } from "./chunked";
import { useMessagesExport } from "./messagesExport";
import { type EvalSampleData } from "./sampleData";

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

const makeWrapper = (client: QueryClient = new QueryClient()) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };

describe("useMessagesExport", () => {
  it("exports a settled monolith conversation", async () => {
    const sampleData = settledData(makeMessages(3));
    const { result } = renderHook(
      () => useMessagesExport(handle, sampleData),
      { wrapper: makeWrapper() }
    );

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
    const { result } = renderHook(
      () => useMessagesExport(handle, sampleData),
      { wrapper: makeWrapper() }
    );

    expect(result.current).toBeUndefined();
  });

  it("hydrates a chunked conversation on demand, once", async () => {
    const messages = makeMessages(4);
    const getRange = vi.fn((lo: number, hi: number) =>
      Promise.resolve(messages.slice(lo, hi))
    );
    const chunked = {
      shell: { id: "s1", epoch: 1, message_refs: [[0, 4]] },
      messages: { getRange },
    } as unknown as ChunkedSample;
    const sampleData: EvalSampleData = {
      sample: undefined,
      status: "ok",
      error: undefined,
      running: [],
      eventsCleared: false,
      backfilling: false,
      chunked,
    };
    const { result } = renderHook(
      () => useMessagesExport(handle, sampleData),
      { wrapper: makeWrapper() }
    );

    // export works without the Messages tab ever having been opened
    const text = await result.current!();
    expect(text).toContain("message 0");
    expect(text).toContain("message 3");

    // a second export reuses the resident hydration
    await result.current!();
    expect(getRange).toHaveBeenCalledTimes(1);
  });
});
