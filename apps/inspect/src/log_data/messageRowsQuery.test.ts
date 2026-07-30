import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { ChatMessage } from "@tsmono/inspect-common/types";
import { type MessageRow } from "@tsmono/inspect-components/chat";
import { type AsyncData } from "@tsmono/util";

import { SampleHandle } from "../app/types";

import { inMemoryMessageRows, type SampleMessagesData } from "./messageRows";
import { useMessageRows } from "./messageRowsQuery";

const handle: SampleHandle = { logFile: "log.eval", id: "s1", epoch: 1 };

const makeMessages = (count: number): ChatMessage[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `m-${i}`,
    role: "user",
    content: `message ${i}`,
  }));

const makeWrapper = (client: QueryClient = new QueryClient()) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };

const renderRows = (src: SampleMessagesData | undefined) =>
  renderHook<
    AsyncData<MessageRow[]>,
    { src: SampleMessagesData | undefined }
  >(({ src }) => useMessageRows(handle, src), {
    wrapper: makeWrapper(),
    initialProps: { src },
  });

describe("useMessageRows", () => {
  it("materializes a source's whole conversation in one read", async () => {
    const { result } = renderRows(inMemoryMessageRows(makeMessages(1200)));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.data).toHaveLength(1200));
    expect(result.current.loading).toBe(false);
    expect(result.current.data?.[1199]?.resolved.message.id).toBe("m-1199");
    // whole-conversation numbering survives the read
    expect(result.current.data?.[1199]?.startNumber).toBe(1200);
  });

  it("reads as loading without a source, even over a warm cache", async () => {
    const { result, rerender } = renderRows(
      inMemoryMessageRows(makeMessages(3))
    );
    await waitFor(() => expect(result.current.data).toHaveLength(3));

    rerender({ src: undefined });
    expect(result.current.data).toBeUndefined();
    expect(result.current.loading).toBe(true);
  });

  it("serves cached rows synchronously when the source returns", async () => {
    const source = inMemoryMessageRows(makeMessages(3));
    const { result, rerender } = renderRows(source);
    await waitFor(() => expect(result.current.data).toHaveLength(3));

    rerender({ src: undefined });
    expect(result.current.data).toBeUndefined();
    rerender({ src: source });
    expect(result.current.data).toHaveLength(3);
  });

  it("surfaces a failed read as error, not endless loading", async () => {
    const failing: SampleMessagesData = {
      rowCount: () => Promise.resolve(0),
      getRows: () => Promise.reject(new Error("boom")),
      exportText: () => Promise.resolve(""),
    };
    const { result } = renderRows(failing);

    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeUndefined();
  });
});
