import { skipToken, useQuery } from "@tanstack/react-query";

import type { MessageRow } from "@tsmono/inspect-components/chat";

import { SampleHandle } from "../app/types";

import { type SampleMessagesData } from "./messageRows";
import { kSampleGcTimeMs } from "./sampleQuery";

/**
 * The Messages tab's rows over a SampleMessagesData source, held in
 * react-query. This stage materializes the whole conversation in one read —
 * still slow on huge samples, but behind the seam a windowed source can
 * later serve page by page without touching consumers.
 *
 * This is the asynchronous rows path: undefined until the source exists
 * and the read settles. Feeds whose rows are already resident don't route
 * through here — the factory composes those in directly, because they must
 * never spend a pending frame (react-query's initialData can't provide
 * that: it only applies when the query instance is first created, and this
 * query mounts sourceless while a sample streams).
 */
export const useMessageRows = (
  handle: SampleHandle | undefined,
  source: SampleMessagesData | undefined
): MessageRow[] | undefined => {
  const query = useQuery({
    // The key carries sample identity only — nothing distinguishes which
    // source (message set, fold options) produced the rows, and staleTime
    // Infinity means a new source under the same handle would serve stale
    // rows. Safe while sources are pure functions of the settled sample;
    // the first live async source (the windowed chunked source) must add
    // its distinguishing inputs here.
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
  return source === undefined ? undefined : query.data;
};
