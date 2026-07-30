import { skipToken } from "@tanstack/react-query";
import { useMemo } from "react";

import type { MessageRow } from "@tsmono/inspect-components/chat";
import { useAsyncDataFromQuery } from "@tsmono/react/hooks";
import { AsyncData, loading as asyncLoading } from "@tsmono/util";

import { SampleHandle } from "../app/types";

import { useChunkedMessages } from "./chunkedMessages";
import { inMemoryMessageRows } from "./messageRows";
import { type EvalSampleData } from "./sampleData";
import { kSampleGcTimeMs } from "./sampleQuery";

/**
 * The settled conversation's rows for a sample, held in react-query.
 * Which feed backs them — completed monolith messages or a hydrated
 * chunked sample — is selected here, behind the SampleMessagesData seam.
 * This stage materializes the whole conversation in one read — still slow
 * on huge samples, but behind the seam a windowed source can later serve
 * page by page without touching consumers.
 *
 * Returns undefined while there is no settled conversation to read (a
 * live streaming sample, a sample still fetching, the Messages tab never
 * activated); loading while one is materializing (chunked hydration, the
 * rows read); the caller owns what covers those states (streaming rows,
 * waiting/loading affordances).
 */
export const useMessageRows = (
  handle: SampleHandle | undefined,
  sampleData: EvalSampleData,
  activated: boolean
): AsyncData<MessageRow[]> | undefined => {
  const chunked = sampleData.chunked;
  const isChunked = chunked !== undefined;
  const chunkedMessages = useChunkedMessages(
    isChunked && activated ? handle : undefined,
    chunked
  );
  const messages = isChunked
    ? chunkedMessages.data
    : sampleData.sample?.messages;
  const source = useMemo(
    () => (messages ? inMemoryMessageRows(messages) : undefined),
    [messages]
  );

  const rows = useAsyncDataFromQuery<MessageRow[]>({
    // CONTRACT: the key omits the source because every source is a pure
    // function of the handle (logs are append-only; fold options are a
    // module constant) — that is what lets staleTime Infinity serve the
    // cached fold forever. A source that breaks the rule (the windowed
    // chunked source, per-user fold options) must add its distinguishing
    // inputs here.
    queryKey: [
      "log_data",
      "message-rows",
      handle?.logFile ?? null,
      handle?.id ?? null,
      handle?.epoch ?? null,
    ],
    queryFn:
      activated && source && handle
        ? async () => {
            const page = await source.getRows({
              cursor: null,
              direction: "forward",
              limit: Number.MAX_SAFE_INTEGER,
            });
            return page.rows;
          }
        : skipToken,
    gcTime: kSampleGcTimeMs,
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    // MessageRows hold large resolved message graphs — never clone/merge.
    structuralSharing: false,
  });

  return useMemo(() => {
    if (!activated) {
      // idle even over a warm cache: rows are served only once the caller
      // activates the read
      return undefined;
    }
    if (isChunked && chunkedMessages.error !== undefined) {
      return { error: chunkedMessages.error, loading: false };
    }
    if (isChunked && chunkedMessages.loading) {
      return asyncLoading;
    }
    return source === undefined ? undefined : rows;
  }, [activated, isChunked, chunkedMessages, source, rows]);
};
