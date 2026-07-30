import { skipToken } from "@tanstack/react-query";

import type { MessageRow } from "@tsmono/inspect-components/chat";
import { useAsyncDataFromQuery } from "@tsmono/react/hooks";
import { AsyncData, loading as asyncLoading } from "@tsmono/util";

import { SampleHandle } from "../app/types";

import { type SampleMessagesData } from "./messageRows";
import { kSampleGcTimeMs } from "./sampleQuery";

/**
 * The Messages tab's rows over a SampleMessagesData source, held in
 * react-query. This stage materializes the whole conversation in one read —
 * still slow on huge samples, but behind the seam a windowed source can
 * later serve page by page without touching consumers.
 *
 * Every settled feed's rows read through here. The read is asynchronous;
 * across the live-finish handoff the caller bridges the pending frames
 * with the last streaming rows (see useSampleMessages) so the list never
 * sees an empty frame.
 */
export const useMessageRows = (
  handle: SampleHandle | undefined,
  source: SampleMessagesData | undefined
): AsyncData<MessageRow[]> => {
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
      source && handle
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
  // Sourceless mounts read as loading even over a warm cache: rows are
  // served only while the caller presents a source (activation gating
  // lives with the caller).
  return source === undefined ? asyncLoading : rows;
};
