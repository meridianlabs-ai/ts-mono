import { useMemo } from "react";

import { SampleSummary } from "../client/api/types";

import { getLogDetail, useLogDetail } from "./logsContent";
import { getPendingSamples, usePendingSamples } from "./pendingSamples";

// Merge a log's completed summaries with its pending-buffer samples
// (exported for tests; consumers use useSampleSummaries / getSampleSummaries)
export const mergeSampleSummaries = (
  logSamples: SampleSummary[],
  pendingSamples: SampleSummary[]
) => {
  // Create a map of existing sample IDs to avoid duplicates
  const existingSampleIds = new Set(
    logSamples.map((sample) => `${sample.id}-${sample.epoch}`)
  );

  // Filter out any pending samples that already exist in the log
  const uniquePendingSamples = pendingSamples
    .filter((sample) => !existingSampleIds.has(`${sample.id}-${sample.epoch}`))
    .map((sample) => {
      // Terminal-with-error pending samples are rendered from the summary
      // by the sample queries' error-summary fallback.
      const isTerminalErrored = sample.completed === true && !!sample.error;
      if (isTerminalErrored) {
        return { ...sample };
      }

      // Pending-buffer samples are not necessarily in the .eval ZIP yet,
      // even if their work has completed. Keep them on the streaming path
      // until they appear in the log summaries.
      return { ...sample, completed: false };
    });

  // Combine and return all samples
  return [...logSamples, ...uniquePendingSamples];
};

/**
 * The live sample-summary list for a log: the details' completed summaries
 * merged with the pending-buffer samples. How the list is assembled (two
 * sources, dedup, streaming-path normalization) is subsystem-private —
 * consumers just get all of a log's samples, kept current.
 */
export const useSampleSummaries = (
  logDir: string,
  logFile: string | undefined
): SampleSummary[] => {
  const logSummaries = useLogDetail(logDir, logFile).data?.sampleSummaries;
  const pending = usePendingSamples(logDir, logFile)?.samples;
  return useMemo(
    () => mergeSampleSummaries(logSummaries ?? [], pending ?? []),
    [logSummaries, pending]
  );
};

/**
 * Non-React snapshot of {@link useSampleSummaries} (for the running-sample
 * query's tick decisions). Empty when there's no resolved dir.
 */
export const getSampleSummaries = (
  logDir: string | undefined,
  logFile: string
): SampleSummary[] =>
  mergeSampleSummaries(
    getLogDetail(logDir, logFile)?.sampleSummaries ?? [],
    getPendingSamples(logDir, logFile)?.samples ?? []
  );
