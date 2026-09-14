import { useQuery } from "@tanstack/react-query";

import { useApi } from "../../state/store";
import { TranscriptInfo } from "../../types/api-types";

import { transcriptsByIdsQuery } from "./queries";

/**
 * Fetches transcripts by id (one IN query) as a transcript_id -> TranscriptInfo
 * map. `sourceIds` records which ids the map was built for so consumers can
 * detect a lookup that outran the query.
 */
export const useTranscriptsByIds = (
  transcriptsDir: string | undefined,
  ids: string[]
): {
  data: Map<string, TranscriptInfo> | undefined;
  sourceIds: Set<string> | undefined;
  loading: boolean;
  error: Error | null;
} => {
  const api = useApi();
  const query = useQuery(transcriptsByIdsQuery(api, transcriptsDir, ids));

  const transcriptMap = query.data
    ? new Map(query.data.map((t) => [t.transcript_id, t]))
    : undefined;

  return {
    data: transcriptMap,
    sourceIds: query.data ? new Set(ids) : undefined,
    loading: query.isLoading,
    error: query.error,
  };
};
