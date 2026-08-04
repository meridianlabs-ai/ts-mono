import { skipToken } from "@tanstack/react-query";
import { useMemo } from "react";

import type { MessageRow } from "@tsmono/inspect-components/chat";
import { useAsyncDataFromQuery } from "@tsmono/react/hooks";
import { AsyncData } from "@tsmono/util";

import { SampleHandle } from "../app/types";

import { type EvalSampleData } from "./sampleData";
import { sampleMessagesSource } from "./sampleMessagesSource";
import { kSampleGcTimeMs } from "./sampleQuery";

/**
 * The settled conversation's rows for a sample, held in react-query.
 * Which feed backs them — inline monolith messages or the windowed source
 * over a chunked sample's conversation — is selected behind the
 * SampleMessagesData seam (`sampleMessagesSource`). This stage reads the
 * whole row space in one getRows call (the chat list renders prebuilt
 * rows); everything below the seam — scanning, chunk fetches, folding —
 * serves that request the same way it will serve real pages when the
 * list virtualizes over them.
 *
 * Returns undefined while there is no settled conversation to read (a
 * live streaming sample, a sample still fetching, the Messages tab never
 * activated); loading while one is materializing; the caller owns what
 * covers those states (streaming rows, waiting/loading affordances).
 */
export const useMessageRows = (
  handle: SampleHandle | undefined,
  sampleData: EvalSampleData,
  activated: boolean
): AsyncData<MessageRow[]> | undefined => {
  const source = sampleMessagesSource(sampleData);

  const rows = useAsyncDataFromQuery<MessageRow[]>({
    // CONTRACT: the key omits the source because every source is a pure
    // function of the handle (logs are append-only; fold options are a
    // module constant) — that is what lets staleTime Infinity serve the
    // cached read forever. A source that breaks the rule (per-user fold
    // options) must add its distinguishing inputs here.
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
    if (!activated || source === undefined) {
      // idle even over a warm cache: rows are served only once the caller
      // activates the read and a settled feed exists
      return undefined;
    }
    return rows;
  }, [activated, source, rows]);
};
