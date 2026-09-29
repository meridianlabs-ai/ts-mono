import { useMemo } from "react";

import { logContentTrust } from "@tsmono/inspect-components/content";
import type { ContentTrust } from "@tsmono/react/components";
import { AsyncData, compose, map as mapAsyncData } from "@tsmono/util";

import { sampleIdsEqual } from "../app/shared/sample";
import { SampleHandle } from "../app/types";
import { SampleSummary } from "../client/api/types";

import { useLogHeader } from "./log";
import { resolveLogKey } from "./logsContent";
import { getPendingSamples, usePendingSamples } from "./pendingSamples";
import { readSettledSummaries, useSamplesListing } from "./samplesListing";

/**
 * A sample summary with the log it came from (its listed name) and that
 * log's trust, attached where the summary list is assembled so they travel
 * with the summary through filtering and sorting.
 */
export type SampleSummaryWithTrust = SampleSummary & {
  readonly logFile: string;
  readonly contentTrust: ContentTrust;
};

/**
 * The summary for `handle`, taken only from its own log's summaries: a log
 * switch keeps the previous log's list on screen until the new one loads,
 * and its samples share ids and epochs with the new log's.
 */
export const findSampleSummary = <T extends SampleSummaryWithTrust>(
  summaries: readonly T[] | undefined,
  logDir: string,
  handle: SampleHandle | undefined
): T | undefined => {
  if (handle === undefined) {
    return undefined;
  }
  const logFile = resolveLogKey(logDir, handle.logFile);
  return summaries?.find(
    (summary) =>
      summary.logFile === logFile &&
      sampleIdsEqual(summary.id, handle.id) &&
      summary.epoch === handle.epoch
  );
};

// Merge a log's completed summaries with its pending-buffer samples
// (exported for tests; consumers use useSampleSummaries / getSampleSummaries)
export const mergeSampleSummaries = <T extends SampleSummary>(
  logSamples: T[],
  pendingSamples: T[]
): T[] => {
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
 *
 * Each summary carries its content trust. A settled summary takes the trust
 * read with it from its own log, so it never lags the summary (and still
 * describes the previous log's rows while a switch keeps them on screen). A
 * pending-buffer summary, which only `logFile` produces, takes that log's
 * trust (untrusted while its header loads).
 */
export const useSampleSummaries = (
  logDir: string,
  logFile: string | undefined
): AsyncData<SampleSummaryWithTrust[]> => {
  // "" matches no stored file; the row set stays empty until a log is given.
  const logKey = logFile === undefined ? "" : resolveLogKey(logDir, logFile);
  const rows = useSamplesListing({ logDir, scope: { file: logKey } });
  const pending = usePendingSamples(logDir, logFile);
  const pendingTrust = logContentTrust(
    useLogHeader(logDir, logFile, { demand: "passive" }).data
  );
  return useMemo(
    () =>
      mapAsyncData(compose({ rows, pending }), (settled) =>
        mergeSampleSummaries<SampleSummaryWithTrust>(
          settled.rows.map((row) => ({
            ...row.summary,
            logFile: row.logFile,
            contentTrust: row.log.contentTrust,
          })),
          (settled.pending?.samples ?? []).map((sample) => ({
            ...sample,
            logFile: logKey,
            contentTrust: pendingTrust,
          }))
        )
      ),
    [rows, pending, pendingTrust, logKey]
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
