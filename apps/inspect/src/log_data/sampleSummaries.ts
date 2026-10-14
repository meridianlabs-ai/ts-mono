import { useMemo } from "react";

import { AsyncData, compose, loading, map as mapAsyncData } from "@tsmono/util";

import { SampleSummary } from "../client/api/types";

import { resolveLogKey } from "./logsContent";
import { getPendingSamples, usePendingSamples } from "./pendingSamples";
import { readSettledSummaries, useSamplesListing } from "./samplesListing";

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
 * The live sample-summary list for a log: the settled summaries (the
 * samples store) merged with the pending-buffer samples. How the list is
 * assembled (two sources, dedup, streaming-path normalization) is
 * subsystem-private — consumers just get all of a log's samples, kept
 * current.
 */
export const useSampleSummaries = (
  logDir: string,
  logFile: string | undefined
): AsyncData<SampleSummary[]> => {
  // "" matches no stored file; the row set stays empty until a log is given.
  const logKey = logFile === undefined ? "" : resolveLogKey(logDir, logFile);
  const rows = useSamplesListing({ logDir, scope: { file: logKey } });
  const pending = usePendingSamples(logDir, logFile);
  return useMemo(
    () =>
      // A log switch keeps the previous log's rows as placeholder data; they
      // must never be shown as (or with the trust of) this log's, so the
      // list is still loading until this log's rows arrive.
      rows.data?.some((row) => row.logFile !== logKey)
        ? loading
        : mapAsyncData(compose({ rows, pending }), (settled) =>
            mergeSampleSummaries(
              settled.rows.map((row) => row.summary),
              settled.pending?.samples ?? []
            )
          ),
    [rows, pending, logKey]
  );
};

/**
 * Non-React snapshot of {@link useSampleSummaries} (for the running-sample
 * query's tick decisions). Empty when there's no resolved dir.
 */
export const getSampleSummaries = async (
  logDir: string | undefined,
  logFile: string
): Promise<SampleSummary[]> =>
  logDir === undefined
    ? []
    : mergeSampleSummaries(
        await readSettledSummaries(logDir, resolveLogKey(logDir, logFile)),
        getPendingSamples(logDir, logFile)?.samples ?? []
      );
