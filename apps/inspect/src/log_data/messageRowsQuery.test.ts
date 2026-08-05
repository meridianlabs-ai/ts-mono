import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { kMessageRowsPageSize, useMessageRows } from "./messageRowsQuery";
import { type EvalSampleData } from "./sampleData";
import {
  failingSequenceReader,
  testHandle as handle,
  testMessages as makeMessages,
  makeWrapper,
  sequenceReaderOver,
  settledData,
  testChunkedSample,
} from "./testFixtures";

const streamingData: EvalSampleData = {
  sample: undefined,
  status: "streaming",
  error: undefined,
  running: [],
  eventsCleared: false,
  backfilling: false,
};

const renderRows = (data: EvalSampleData, activated = true) =>
  renderHook(
    ({ data, activated }: { data: EvalSampleData; activated: boolean }) =>
      useMessageRows(handle, data, activated),
    { wrapper: makeWrapper(), initialProps: { data, activated } }
  );

describe("useMessageRows", () => {
  it("serves a settled conversation one page at a time", async () => {
    const { result } = renderRows(settledData(makeMessages(1200)));

    expect(result.current?.rows.loading).toBe(true);
    await waitFor(() =>
      expect(result.current?.rows.data).toHaveLength(kMessageRowsPageSize)
    );
    expect(result.current?.hasMore).toBe(true);
    // whole-conversation numbering survives the paged read
    expect(result.current?.rows.data?.[99]?.startNumber).toBe(100);

    act(() => result.current?.loadMore());
    await waitFor(() =>
      expect(result.current?.rows.data).toHaveLength(2 * kMessageRowsPageSize)
    );
    expect(result.current?.rows.data?.[199]?.resolved.message.id).toBe(
      "m-199"
    );
    expect(result.current?.hasMore).toBe(true);
  });

  it("reports exhaustion on the last page", async () => {
    const { result } = renderRows(settledData(makeMessages(150)));
    await waitFor(() =>
      expect(result.current?.rows.data).toHaveLength(kMessageRowsPageSize)
    );
    expect(result.current?.hasMore).toBe(true);

    act(() => result.current?.loadMore());
    await waitFor(() => expect(result.current?.rows.data).toHaveLength(150));
    expect(result.current?.hasMore).toBe(false);
  });

  it("handles an empty settled conversation", async () => {
    const { result } = renderRows(settledData([]));
    await waitFor(() => expect(result.current?.rows.data).toHaveLength(0));
    expect(result.current?.hasMore).toBe(false);
  });

  it("is idle without activation, even over a warm cache", async () => {
    const data = settledData(makeMessages(3));
    const { result, rerender } = renderRows(data);
    await waitFor(() => expect(result.current?.rows.data).toHaveLength(3));

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
    await waitFor(() => expect(result.current?.rows.data).toHaveLength(3));

    rerender({ data, activated: false });
    expect(result.current).toBeUndefined();
    rerender({ data, activated: true });
    expect(result.current?.rows.data).toHaveLength(3);
  });

  it("reads a chunked sample through the windowed source", async () => {
    const chunked = testChunkedSample(sequenceReaderOver(makeMessages(4)));
    const data: EvalSampleData = { ...streamingData, status: "ok", chunked };
    const { result } = renderRows(data);

    expect(result.current?.rows.loading).toBe(true);
    await waitFor(() => expect(result.current?.rows.data).toHaveLength(4));
    expect(result.current?.hasMore).toBe(false);
  });

  it("drains pages until a deep-link target is resident before serving rows", async () => {
    const servedLengths: number[] = [];
    const { result } = renderHook(
      () => {
        const feed = useMessageRows(
          handle,
          settledData(makeMessages(300)),
          true,
          "m-150"
        );
        if (feed?.rows.data !== undefined) {
          servedLengths.push(feed.rows.data.length);
        }
        return feed;
      },
      { wrapper: makeWrapper() }
    );

    // the drain stops at the covering page, not the conversation's end
    await waitFor(() =>
      expect(result.current?.rows.data).toHaveLength(2 * kMessageRowsPageSize)
    );
    expect(result.current?.hasMore).toBe(true);
    // rows were never served without the target resident: the list mounts
    // with its initial scroll index resolvable
    expect(servedLengths.every((l) => l === 2 * kMessageRowsPageSize)).toBe(
      true
    );
  });

  it("a target the conversation never renders drains to exhaustion, then serves", async () => {
    const { result } = renderHook(
      () =>
        useMessageRows(handle, settledData(makeMessages(250)), true, "nope"),
      { wrapper: makeWrapper() }
    );

    await waitFor(() => expect(result.current?.rows.data).toHaveLength(250));
    expect(result.current?.hasMore).toBe(false);
  });

  it("surfaces a chunked read failure as error, not endless loading", async () => {
    const chunked = testChunkedSample(
      failingSequenceReader(new Error("boom")),
      [[0, 2]]
    );
    const data: EvalSampleData = { ...streamingData, status: "ok", chunked };
    const { result } = renderRows(data);

    await waitFor(() =>
      expect(result.current?.rows.error).toBeInstanceOf(Error)
    );
    expect(result.current?.rows.loading).toBe(false);
    expect(result.current?.rows.data).toBeUndefined();
  });
});
