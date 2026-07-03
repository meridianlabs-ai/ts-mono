import { skipToken, useQuery } from "@tanstack/react-query";

import { createLogger } from "@tsmono/util";

import { getApi } from "../app_config";
import {
  ClientAPI,
  LogDetails,
  PendingSampleResponse,
  PendingSamples,
  RunningMetric,
} from "../client/api/types";
import { queryClient } from "../state/queryClient";

import { fetchEngine } from "./fetchEngine";
import { useLogDetail } from "./logsContent";

const log = createLogger("pendingSamples");

const kDefaultRefreshSeconds = 2;

export const pendingSamplesKey = (
  logDir: string,
  logFile: string | undefined
) => ["pending-samples", logDir, logFile ?? null] as const;

/**
 * A running eval's sample buffer (pending sample summaries + running metrics)
 * as a poll-driven react-query query keyed on `(logDir, logFile)`. Polling has
 * no imperative start/stop: enablement derives from the log's live status,
 * cadence from the server's refresh hint, and teardown from the query key
 * changing. Each tick threads the previous data's etag and produces the
 * watched log into the fetch engine at elevated priority so the completed
 * summaries / status stay fresh alongside the buffer.
 */

export interface PendingSamplesPollInputs {
  logFile: string | undefined;
  logStatus: LogDetails["status"] | undefined;
  apiSupportsPendingSamples: boolean;
}

/** Poll while a log is given, still running, and the api has a buffer. */
export const shouldPollPendingSamples = (
  inputs: PendingSamplesPollInputs
): boolean =>
  inputs.logFile !== undefined &&
  inputs.logStatus === "started" &&
  inputs.apiSupportsPendingSamples;

export const pendingSamplesIntervalMs = (
  data: PendingSamples | null | undefined
): number => (data?.refresh ?? kDefaultRefreshSeconds) * 1000;

/**
 * The next cache value given a poll response. `NotFound` means the buffer is
 * gone (eval completed) or not written yet (eval just started) — either way
 * there are no pending samples to show.
 */
export const nextPendingSamples = (
  prev: PendingSamples | null,
  response: PendingSampleResponse
): PendingSamples | null => {
  switch (response.status) {
    case "OK":
      return response.pendingSamples ?? prev;
    case "NotModified":
      return prev;
    case "NotFound":
      return null;
  }
};

/** One poll tick (the queryFn; exported for tests). */
export const fetchPendingSamples = async (
  api: ClientAPI,
  logDir: string,
  logFile: string
): Promise<PendingSamples | null> => {
  const getPendingSamples = api.get_log_pending_samples;
  if (!getPendingSamples) {
    throw new Error("API does not support pending samples");
  }
  const prev =
    queryClient.getQueryData<PendingSamples | null>(
      pendingSamplesKey(logDir, logFile)
    ) ?? null;
  const response = await getPendingSamples(logFile, prev?.etag);
  if (response.status === "OK") {
    // Fresh buffer data: let it land now; refresh the details in the
    // background.
    void fetchEngine
      .fetch(logFile, "elevated")
      .catch((error) => log.debug("Error refreshing log details", error));
  } else if (response.status === "NotFound") {
    // Buffer gone: await the details refresh so the pending rows are dropped
    // only once the fresh summaries/status (which may end the poll) are in.
    await fetchEngine.fetch(logFile, "elevated");
  }
  return nextPendingSamples(prev, response);
};

/**
 * The pending samples for a log, polled while it is running. Settles to
 * `undefined` when there is nothing pending (log not running, api without a
 * buffer, no data yet). Polling lifetime is subscriber lifetime: every
 * dependent calls this to declare its own dependency.
 */
export const usePendingSamples = (
  logDir: string,
  logFile: string | undefined
): PendingSamples | undefined => {
  const api = getApi();
  const liveStatus = useLogDetail(logDir, logFile).data?.status;
  const enabled =
    shouldPollPendingSamples({
      logFile,
      logStatus: liveStatus,
      apiSupportsPendingSamples: api.get_log_pending_samples !== undefined,
    }) && logFile !== undefined;
  const { data } = useQuery({
    queryKey: pendingSamplesKey(logDir, logFile),
    queryFn: enabled
      ? () => fetchPendingSamples(api, logDir, logFile)
      : skipToken,
    // A failed tick retries per the client default, then parks the query in
    // error state; stopping the interval there is the give-up.
    refetchInterval: (query) =>
      query.state.status === "error"
        ? false
        : pendingSamplesIntervalMs(query.state.data),
    refetchIntervalInBackground: true,
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  // Gate the read on enablement: once the log stops running, the final
  // details refresh owns the summaries and any cached buffer data is stale.
  return enabled ? (data ?? undefined) : undefined;
};

/**
 * A running eval's live metrics. Settles to `undefined` when the log isn't
 * running or no metrics have been reported yet. That the metrics travel in
 * the pending-samples buffer is subsystem-private.
 */
export const useRunningMetrics = (
  logDir: string,
  logFile: string | undefined
): RunningMetric[] | undefined =>
  usePendingSamples(logDir, logFile)?.metrics;

/**
 * Non-React snapshot of the pending samples (for the running-sample query's
 * finalize decision). Returns
 * `undefined` when there's no resolved dir.
 */
export const getPendingSamples = (
  logDir: string | undefined,
  logFile: string
): PendingSamples | undefined =>
  logDir === undefined
    ? undefined
    : (queryClient.getQueryData<PendingSamples | null>(
        pendingSamplesKey(logDir, logFile)
      ) ?? undefined);
