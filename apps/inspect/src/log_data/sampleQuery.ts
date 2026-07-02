import { skipToken, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { EvalSample } from "@tsmono/inspect-common/types";
import { useAsyncDataFromQuery } from "@tsmono/react/hooks";
import { AsyncData, data as asyncData } from "@tsmono/util";

import { getApi, useLogDir } from "../app_config";
import { SampleHandle } from "../app/types";
import { SampleSummary } from "../client/api/types";

import {
  fetchSample,
  SampleNotFoundError,
  synthesizeErroredSampleFromSummary,
} from "./sampleFetch";

// Samples are large: keep unwatched bodies only briefly so back/forward
// navigation stays snappy without accumulating every visited sample.
export const kSampleGcTimeMs = 30_000;

export const sampleQueryKey = (
  logDir: string,
  handle: SampleHandle | undefined
) =>
  [
    "sample",
    logDir,
    handle?.logFile ?? null,
    handle?.id ?? null,
    handle?.epoch ?? null,
  ] as const;

/**
 * The error-summary fallback for a completed-sample fetch: when the backend
 * has no body for the sample but its summary records an error, present a
 * sample synthesized from the summary. This is presentation, not acquisition,
 * so it applies to the query result rather than inside `fetchSample`. A miss
 * without a summary error stays an error.
 */
export const withErrorSummaryFallback = (
  result: AsyncData<EvalSample>,
  summary: SampleSummary | undefined
): AsyncData<EvalSample> =>
  result.error instanceof SampleNotFoundError && summary?.error
    ? asyncData(synthesizeErroredSampleFromSummary(summary))
    : result;

/**
 * A completed sample's body, keyed `["sample", logDir, logFile, id, epoch]`.
 * Idles (`skipToken`) without a handle — callers pass the handle only for
 * samples on the completed path. `summary` feeds the error-summary fallback.
 */
export const useSample = (
  handle: SampleHandle | undefined,
  summary?: SampleSummary
): AsyncData<EvalSample> => {
  const logDir = useLogDir();
  const result = useAsyncDataFromQuery({
    queryKey: sampleQueryKey(logDir, handle),
    queryFn: handle
      ? () => fetchSample(getApi(), handle.logFile, handle.id, handle.epoch)
      : skipToken,
    gcTime: kSampleGcTimeMs,
    // A missing body is a definitive miss (fallback territory), not a
    // transient failure; other errors surface immediately — parity with the
    // legacy single-shot loader.
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  return useMemo(
    () => withErrorSummaryFallback(result, summary),
    [result, summary]
  );
};

/**
 * Passive read of the sample cache for a handle: subscribes without ever
 * fetching, so consumers outside the sample views (e.g. the invalidation
 * banner) don't keep the query alive or trigger downloads of large bodies.
 */
export const useCachedSample = (
  handle: SampleHandle | undefined
): EvalSample | undefined => {
  const logDir = useLogDir();
  const { data } = useQuery<EvalSample>({
    queryKey: sampleQueryKey(logDir, handle),
    queryFn: skipToken,
    gcTime: kSampleGcTimeMs,
  });
  return data;
};
