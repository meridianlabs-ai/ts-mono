import { skipToken } from "@tanstack/react-query";

import { ChatMessage } from "@tsmono/inspect-common/types";
import { useAsyncDataFromQuery } from "@tsmono/react/hooks";
import { AsyncData } from "@tsmono/util";

import { SampleHandle } from "../app/types";

import { type ChunkedSample } from "./chunked";
import { chunkedConversation } from "./conversation";
import { kSampleGcTimeMs } from "./sampleQuery";

/**
 * Hydrate a chunked sample's final conversation — a degenerate full-range
 * read on the conversation seam, yielding the same material a monolith
 * sample stores inline as `messages`.
 *
 * INTERIM: full hydration is a bridge until the Messages tab pages by
 * index window (design/large-samples.md, access pattern 3 / effort C3).
 * "The final conversation is conversation-sized" does NOT hold under
 * compaction — measured 134,989 messages / 7,961 ranges (~135MB of member
 * fetches) on the mirror-code monster — so this matches the monolith
 * path's memory profile, no better. Windowed replacement is C3; this
 * fetches on-demand (tab open), never at sample open.
 */
export const hydrateFinalConversation = (
  chunked: ChunkedSample
): Promise<ChatMessage[]> => {
  const conversation = chunkedConversation(chunked);
  return conversation.getMessages(0, conversation.messageCount);
};

export const chunkedMessagesQueryKey = (handle: SampleHandle | undefined) =>
  [
    "log_data",
    "chunked-messages",
    handle?.logFile ?? null,
    handle?.id ?? null,
    handle?.epoch ?? null,
  ] as const;

/**
 * The final conversation for the Messages tab, hydrated on first use and
 * cached alongside the sample queries.
 */
export const useChunkedMessages = (
  handle: SampleHandle | undefined,
  chunked: ChunkedSample | undefined
): AsyncData<ChatMessage[]> =>
  useAsyncDataFromQuery({
    queryKey: chunkedMessagesQueryKey(handle),
    queryFn:
      chunked && handle ? () => hydrateFinalConversation(chunked) : skipToken,
    gcTime: kSampleGcTimeMs,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    structuralSharing: false,
  });
