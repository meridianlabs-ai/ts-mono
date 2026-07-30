import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { ChatMessage, EvalSample } from "@tsmono/inspect-common/types";

import { SampleHandle } from "../app/types";

import { type ChunkedSample } from "./chunked";
import { useMessageRows } from "./messageRowsQuery";
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

const streamingData: EvalSampleData = {
  sample: undefined,
  status: "streaming",
  error: undefined,
  running: [],
  eventsCleared: false,
  backfilling: false,
};

const makeWrapper = (client: QueryClient = new QueryClient()) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };

const renderRows = (data: EvalSampleData, activated = true) =>
  renderHook(
    ({
      data,
      activated,
    }: {
      data: EvalSampleData;
      activated: boolean;
    }) => useMessageRows(handle, data, activated),
    { wrapper: makeWrapper(), initialProps: { data, activated } }
  );

describe("useMessageRows", () => {
  it("materializes a settled conversation in one read", async () => {
    const { result } = renderRows(settledData(makeMessages(1200)));

    expect(result.current?.loading).toBe(true);
    await waitFor(() => expect(result.current?.data).toHaveLength(1200));
    expect(result.current?.loading).toBe(false);
    expect(result.current?.data?.[1199]?.resolved.message.id).toBe("m-1199");
    // whole-conversation numbering survives the read
    expect(result.current?.data?.[1199]?.startNumber).toBe(1200);
  });

  it("is idle without activation, even over a warm cache", async () => {
    const data = settledData(makeMessages(3));
    const { result, rerender } = renderRows(data);
    await waitFor(() => expect(result.current?.data).toHaveLength(3));

    rerender({ data, activated: false });
    expect(result.current).toBeUndefined();
  });

  it("is idle while no settled conversation exists", () => {
    const { result } = renderRows(streamingData);
    expect(result.current).toBeUndefined();
  });

  it("serves cached rows synchronously when the read reactivates", async () => {
    const data = settledData(makeMessages(3));
    const { result, rerender } = renderRows(data);
    await waitFor(() => expect(result.current?.data).toHaveLength(3));

    rerender({ data, activated: false });
    expect(result.current).toBeUndefined();
    rerender({ data, activated: true });
    expect(result.current?.data).toHaveLength(3);
  });

  it("reads a chunked sample through hydration", async () => {
    const messages = makeMessages(4);
    const chunked = {
      shell: { id: "s1", epoch: 1, message_refs: [[0, 4]] },
      messages: {
        getRange: (lo: number, hi: number) =>
          Promise.resolve(messages.slice(lo, hi)),
      },
    } as unknown as ChunkedSample;
    const data: EvalSampleData = { ...streamingData, status: "ok", chunked };
    const { result } = renderRows(data);

    expect(result.current?.loading).toBe(true);
    await waitFor(() => expect(result.current?.data).toHaveLength(4));
  });

  it("surfaces a chunked hydration failure as error, not endless loading", async () => {
    const chunked = {
      shell: { id: "s1", epoch: 1, message_refs: [[0, 2]] },
      messages: { getRange: () => Promise.reject(new Error("boom")) },
    } as unknown as ChunkedSample;
    const data: EvalSampleData = { ...streamingData, status: "ok", chunked };
    const { result } = renderRows(data);

    await waitFor(() =>
      expect(result.current?.error).toBeInstanceOf(Error)
    );
    expect(result.current?.loading).toBe(false);
    expect(result.current?.data).toBeUndefined();
  });
});
