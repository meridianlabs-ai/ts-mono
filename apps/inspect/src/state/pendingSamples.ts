import { skipToken, useQuery } from "@tanstack/react-query";

import { createLogger } from "@tsmono/util";

import { getApi, useLogDir } from "../app_config";
import {
  ClientAPI,
  LogDetails,
  PendingSampleResponse,
  PendingSamples,
} from "../client/api/types";
import { fetchEngine, useLogDetail } from "../log_data";

import { queryClient } from "./queryClient";
import { useStore } from "./store";

const log = createLogger("pendingSamples");

const kDefaultRefreshSeconds = 2;

export const pendingSamplesKey = (
  logDir: string,
  logFile: string | undefined
) => ["pending-samples", logDir, logFile ?? null] as const;

/**
 * A running eval's sample buffer (pending sample summaries + running metrics)
 * as a poll-driven react-query query keyed on `(logDir, logFile)`. Polling has
 * no imperative start/stop: enablement derives from the selection and the
 * log's live status, cadence from the server's refresh hint, and teardown from
 * the query key changing. Each tick threads the previous data's etag and
 * produces the watched log into the fetch engine at elevated priority so the
 * completed summaries / status stay fresh alongside the buffer.
 */

export interface PendingSamplesPollInputs {
  logFile: string | undefined;
  logStatus: LogDetails["status"] | undefined;
  apiSupportsPendingSamples: boolean;
}

/** Poll while a log is selected, still running, and the api has a buffer. */
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
 * The pending samples for the selected log, polled while it is running.
 * Settles to `undefined` when there is nothing pending (log not running, api
 * without a buffer, no data yet). Mounted by `LogLoadController` so polling
 * never depends on which consumer tab happens to be visible; consumers call
 * it directly to subscribe.
 */
export const usePendingSamples = (): PendingSamples | undefined => {
  const logDir = useLogDir();
  const api = getApi();
  const selectedLogFile = useStore((state) => state.logs.selectedLogFile);
  const liveStatus = useLogDetail(logDir, selectedLogFile).data?.status;
  const enabled =
    shouldPollPendingSamples({
      logFile: selectedLogFile,
      logStatus: liveStatus,
      apiSupportsPendingSamples: api.get_log_pending_samples !== undefined,
    }) && selectedLogFile !== undefined;
  const { data } = useQuery({
    queryKey: pendingSamplesKey(logDir, selectedLogFile),
    queryFn: enabled
      ? () => fetchPendingSamples(api, logDir, selectedLogFile)
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
