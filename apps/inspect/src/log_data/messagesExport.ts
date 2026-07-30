import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import { SampleHandle } from "../app/types";

import {
  chunkedMessagesQueryKey,
  hydrateFinalConversation,
} from "./chunkedMessages";
import { inMemoryMessageRows } from "./messageRows";
import { type EvalSampleData } from "./sampleData";
import { kSampleGcTimeMs } from "./sampleQuery";

/**
 * Copy/Download > Messages: the settled conversation as text, produced on
 * demand. Undefined when there is no settled conversation to export (live
 * streaming samples, a sample still loading). Chunked samples hydrate on
 * first use, through the same query the Messages tab reads, so export
 * never requires the tab to have been opened.
 */
export const useMessagesExport = (
  handle: SampleHandle | undefined,
  sampleData: EvalSampleData
): (() => Promise<string>) | undefined => {
  const queryClient = useQueryClient();
  const chunked = sampleData.chunked;
  const messages = chunked === undefined ? sampleData.sample?.messages : undefined;
  return useMemo(() => {
    if (chunked && handle) {
      return async () => {
        const hydrated = await queryClient.fetchQuery({
          queryKey: chunkedMessagesQueryKey(handle),
          queryFn: () => hydrateFinalConversation(chunked),
          gcTime: kSampleGcTimeMs,
          // a settled chunked conversation is immutable: reuse a resident
          // hydration instead of re-fetching it per export
          staleTime: Infinity,
        });
        return inMemoryMessageRows(hydrated).exportText();
      };
    }
    if (messages) {
      return () => inMemoryMessageRows(messages).exportText();
    }
    return undefined;
  }, [queryClient, chunked, handle, messages]);
};
