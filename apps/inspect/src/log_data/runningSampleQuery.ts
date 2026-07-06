import { skipToken } from "@tanstack/react-query";

import { useAsyncDataFromQuery } from "@tsmono/react/hooks";
import { AsyncData } from "@tsmono/util";

import { getApi } from "../app_config";
import { sampleIdsEqual } from "../app/shared/sample";
import { SampleHandle } from "../app/types";
import { ClientAPI, LogDetails, SampleSummary } from "../client/api/types";
import { queryClient } from "../state/queryClient";

import { useLogDetail } from "./logDetail";
import { resolveLogKey } from "./logsContent";
import {
  fetchSample,
  SampleNotFoundError,
  synthesizeErroredSampleFromSummary,
} from "./sampleFetch";
import { kSampleGcTimeMs, sampleQueryKey } from "./sampleQuery";
import { readSettledSummaries } from "./samplesListing";
import {
  createSampleStreamSession,
  SampleEvent,
  SampleStreamSession,
} from "./sampleStream";
import { getSampleSummaries } from "./sampleSummaries";

const kRunningSampleIntervalMs = 2_000;

export const runningSampleQueryKey = (
  logDir: string,
  handle: SampleHandle | undefined
) =>
  [
    "log_data",
    "running-sample",
    logDir,
    handle?.logFile ?? null,
    handle?.id ?? null,
    handle?.epoch ?? null,
  ] as const;

export interface RunningSampleData {
  /** Events streamed so far; identity is stable across ticks that add none. */
  events: SampleEvent[];
  /** The stream ended and the completed EvalSample was primed into `["log_data", "sample"]`. */
  finalized: boolean;
}

export interface RunningSampleStreamInputs {
  handle: SampleHandle | undefined;
  /** `completed` from the selected sample's (merged) summary. */
  summaryCompleted: boolean | undefined;
  logStatus: LogDetails["status"] | undefined;
}

/**
 * Stream while a sample is selected, its summary explicitly reports it
 * incomplete, and the log is still live. When the summary settles the
 * completed-path query takes over.
 */
export const shouldStreamRunningSample = (
  inputs: RunningSampleStreamInputs
): boolean =>
  inputs.handle !== undefined &&
  inputs.summaryCompleted === false &&
  inputs.logStatus === "started";

interface StreamSlot {
  key: string;
  session: SampleStreamSession;
  last: RunningSampleData | undefined;
}

// One streaming session at a time (there is one selected sample), addressed by
// query key: a key change replaces the slot, and that replacement IS the
// teardown — no stop call, no AbortController. A stale in-flight tick keeps
// mutating only its own (unreachable) slot and priming only its own handle's
// cache entry, so it cannot corrupt the new sample's stream.
let slot: StreamSlot | undefined;

const slotFor = (
  api: ClientAPI,
  logDir: string,
  handle: SampleHandle
): StreamSlot => {
  const key = JSON.stringify(runningSampleQueryKey(logDir, handle));
  if (slot?.key !== key) {
    slot = {
      key,
      session: createSampleStreamSession(
        api,
        handle.logFile,
        handle.id,
        handle.epoch
      ),
      last: undefined,
    };
  }
  return slot;
};

/** The opened log's settled summaries report the sample completed (finalize
 *  input) — no pending merge, mirroring what the log file itself records. */
const hasCompletedLogSummary = async (
  logDir: string,
  handle: SampleHandle
): Promise<boolean> => {
  const summaries = await readSettledSummaries(
    logDir,
    resolveLogKey(logDir, handle.logFile)
  );
  return summaries.some(
    (summary) =>
      sampleIdsEqual(summary.id, handle.id) &&
      summary.epoch === handle.epoch &&
      summary.completed !== false
  );
};

const findLiveSummary = async (
  logDir: string,
  handle: SampleHandle
): Promise<SampleSummary | undefined> =>
  (await getSampleSummaries(logDir, handle.logFile)).find(
    (summary) =>
      sampleIdsEqual(summary.id, handle.id) && summary.epoch === handle.epoch
  );

/**
 * Fetch the completed EvalSample for a stream that reported done and prime it
 * into the `["log_data", "sample"]` cache, so the completed-path query settles instantly
 * once the summary flips. Returns whether the stream is truly final: a
 * flushed buffer whose EvalSample isn't readable yet keeps streaming instead
 * of erroring, and a missing EvalSample whose summary records an error primes
 * a synthesized sample. Anything else propagates as the query's error.
 */
const finalizeRunningSample = async (
  api: ClientAPI,
  logDir: string,
  handle: SampleHandle,
  bufferComplete: boolean
): Promise<boolean> => {
  try {
    const sample = await fetchSample(
      api,
      handle.logFile,
      handle.id,
      handle.epoch
    );
    queryClient.setQueryData(sampleQueryKey(logDir, handle), sample);
    return true;
  } catch (error) {
    if (bufferComplete) {
      return false;
    }
    if (error instanceof SampleNotFoundError) {
      const summary = await findLiveSummary(logDir, handle);
      if (summary?.error) {
        queryClient.setQueryData(
          sampleQueryKey(logDir, handle),
          synthesizeErroredSampleFromSummary(summary)
        );
        return true;
      }
    }
    throw error;
  }
};

/** One poll tick over the streaming session (the queryFn; exported for tests). */
export const streamRunningSampleTick = async (
  api: ClientAPI,
  logDir: string,
  handle: SampleHandle
): Promise<RunningSampleData> => {
  const streamSlot = slotFor(api, logDir, handle);
  const tick = await streamSlot.session.tick(
    await hasCompletedLogSummary(logDir, handle)
  );
  const finalized = tick.done
    ? await finalizeRunningSample(api, logDir, handle, tick.bufferComplete)
    : false;
  const next = { events: tick.events, finalized };
  // Hand back the previous object when nothing changed so no-op ticks don't
  // churn the query data identity (structural sharing is off — see the hook).
  const last = streamSlot.last;
  if (
    last !== undefined &&
    last.events === next.events &&
    last.finalized === next.finalized
  ) {
    return last;
  }
  streamSlot.last = next;
  return next;
};

/**
 * Poll-driven incremental query over a running sample's event stream, keyed
 * `["log_data", "running-sample", logDir, logFile, id, epoch]`. Nothing imperative:
 * enablement derives from the summary and the log's live status
 * (`shouldStreamRunningSample`), cadence is a fixed 2s `refetchInterval`, and
 * teardown is the key changing. When the stream ends, the tick primes the
 * completed EvalSample into the `["log_data", "sample"]` cache and reports `finalized`; the
 * interval stops on `finalized` or error. Disabled with the same key (summary
 * settled first), the query still serves its cached events so the completed
 * path can bridge with them while its own fetch settles.
 */
export const useRunningSample = (
  logDir: string,
  handle: SampleHandle | undefined,
  summary: SampleSummary | undefined
): AsyncData<RunningSampleData> => {
  const logStatus = useLogDetail(logDir, handle?.logFile).data?.status;
  const enabled = shouldStreamRunningSample({
    handle,
    summaryCompleted: summary?.completed,
    logStatus,
  });
  return useAsyncDataFromQuery({
    queryKey: runningSampleQueryKey(logDir, handle),
    queryFn:
      enabled && handle !== undefined
        ? () => streamRunningSampleTick(getApi(), logDir, handle)
        : skipToken,
    // The session already keeps the events array identity stable across no-op
    // ticks; the default deep-compare would walk the whole event tree instead.
    structuralSharing: false,
    refetchInterval: (query) =>
      query.state.status === "error" || query.state.data?.finalized === true
        ? false
        : kRunningSampleIntervalMs,
    refetchIntervalInBackground: true,
    // Streamed events are as large as EvalSamples; don't retain idle ones.
    gcTime: kSampleGcTimeMs,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
};
