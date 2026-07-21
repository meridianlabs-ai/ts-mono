import { skipToken } from "@tanstack/react-query";

import { ChatMessage } from "@tsmono/inspect-common/types";
import { useAsyncDataFromQuery } from "@tsmono/react/hooks";
import { AsyncData } from "@tsmono/util";

import { SampleHandle } from "../app/types";

import { type ChunkedSample } from "./chunked";
import { log } from "./chunked/log";
import { withAttachmentsResolved } from "./chunkedAttachments";
import { kSampleGcTimeMs } from "./sampleQuery";

/**
 * Hydrate a chunked sample's final conversation: the shell's `message_refs`
 * ranges resolved against the messages sequence, attachments substituted —
 * the same material a monolith sample stores inline as `messages`.
 *
 * INTERIM: full hydration is a bridge until the Messages tab pages by
 * index window (design/large-samples.md, access pattern #3). "The final
 * conversation is conversation-sized" does NOT hold under compaction —
 * measured 134,989 messages / 7,961 ranges (~135MB of member fetches) on
 * the mirror-code monster — so this matches the monolith path's memory
 * profile, no better. Windowed replacement is planned; this fetches
 * on-demand (tab open), never at sample open.
 */
export const hydrateFinalConversation = async (
  chunked: ChunkedSample
): Promise<ChatMessage[]> => {
  const refs = chunked.shell.message_refs;
  const ranges = await Promise.all(
    refs.map(([start, end]) => chunked.messages.getRange(start, end))
  );
  const messages = ranges.flat();
  log.info(
    `hydrate final conversation: ${messages.length} messages via ` +
      `${refs.length} range${refs.length === 1 ? "" : "s"}`
  );
  return withAttachmentsResolved(messages, chunked, "final conversation");
};

/**
 * The final conversation for the Messages tab, hydrated on first use and
 * cached alongside the sample queries.
 */
export const useChunkedMessages = (
  logDir: string,
  handle: SampleHandle | undefined,
  chunked: ChunkedSample | undefined
): AsyncData<ChatMessage[]> =>
  useAsyncDataFromQuery({
    queryKey: [
      "log_data",
      "chunked-messages",
      logDir,
      handle?.logFile ?? null,
      handle?.id ?? null,
      handle?.epoch ?? null,
    ],
    queryFn:
      chunked && handle ? () => hydrateFinalConversation(chunked) : skipToken,
    gcTime: kSampleGcTimeMs,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    structuralSharing: false,
  });
