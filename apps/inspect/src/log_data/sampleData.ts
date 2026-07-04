import { useMemo } from "react";

import { EvalSample } from "@tsmono/inspect-common/types";
import { AsyncData } from "@tsmono/util";

import { Events } from "../@types/extraInspect";
import { sampleIdsEqual } from "../app/shared/sample";
import { SampleHandle, SampleStatus } from "../app/types";
import { SampleSummary } from "../client/api/types";

import { RunningSampleData, useRunningSample } from "./runningSampleQuery";
import { usePassiveEvalSample, useSample } from "./sampleQuery";
import { useSampleSummaries } from "./sampleSummaries";

const kNoRunningEvents: Events = [];

export interface SampleData {
  /** The settled EvalSample: completed fetch, error-summary fallback, or
   *  a just-finalized streaming sample. */
  sample: EvalSample | undefined;
  status: SampleStatus;
  error: Error | undefined;
  /** Streamed events for a still-running sample; empty on the completed path. */
  running: Events;
  /** True when the preprocessor stripped events from an oversized sample
   *  (messages remain). */
  eventsCleared: boolean;
}

const settledSampleData = (sample: EvalSample): SampleData => ({
  sample,
  status: "ok",
  error: undefined,
  running: kNoRunningEvents,
  eventsCleared:
    sample.events.length === 0 && (sample.messages?.length ?? 0) > 0,
});

export interface SampleDataInputs {
  handle: SampleHandle | undefined;
  /** The sample's merged summary (undefined while the summaries settle). */
  summary: SampleSummary | undefined;
  /** The completed-path EvalSample query. */
  query: AsyncData<EvalSample>;
  /** The running-path stream query. */
  running: AsyncData<RunningSampleData>;
  /** The finalized EvalSample a running stream primed into the sample cache. */
  finalizedSample: EvalSample | undefined;
}

/** The path-selection state machine (exported for tests). */
export const deriveSampleData = ({
  handle,
  summary,
  query,
  running,
  finalizedSample,
}: SampleDataInputs): SampleData => {
  // Without a summary the sample isn't loadable yet (the legacy loader
  // waited for it too), so idle rather than reading as loading.
  if (handle === undefined || summary === undefined) {
    return {
      sample: undefined,
      status: "ok",
      error: undefined,
      running: kNoRunningEvents,
      eventsCleared: false,
    };
  }
  // `completed !== false` mirrors the legacy loader: only an explicitly
  // incomplete summary takes the running path.
  if (summary.completed === false) {
    if (running.data?.finalized === true && finalizedSample !== undefined) {
      return settledSampleData(finalizedSample);
    }
    if (running.error) {
      return {
        sample: undefined,
        status: "error",
        error: running.error,
        running: kNoRunningEvents,
        eventsCleared: false,
      };
    }
    return {
      sample: undefined,
      status: running.data === undefined ? "loading" : "streaming",
      error: undefined,
      running: running.data?.events ?? kNoRunningEvents,
      eventsCleared: false,
    };
  }
  if (query.data !== undefined) {
    return settledSampleData(query.data);
  }
  // The summary settled before the stream finalized: keep showing the
  // stream's cached events while the completed fetch settles.
  if (
    query.loading &&
    running.data !== undefined &&
    running.data.events.length > 0
  ) {
    return {
      sample: undefined,
      status: "streaming",
      error: undefined,
      running: running.data.events,
      eventsCleared: false,
    };
  }
  return {
    sample: undefined,
    status: query.loading ? "loading" : query.error ? "error" : "ok",
    error: query.loading ? undefined : query.error,
    running: kNoRunningEvents,
    eventsCleared: false,
  };
};

/**
 * A sample's data — EvalSample, stream, and status — as one derivation over
 * the subsystem's sample queries. Which path serves the EvalSample (completed
 * fetch, error-summary fallback, live stream, finalize handoff) is
 * subsystem-private; a finalizing stream primes the completed EvalSample into
 * the sample cache so the handoff never flashes a loading state, and if the
 * summary settles before the stream finalizes, the stream's cached events
 * bridge the completed fetch.
 */
export const useSampleData = (
  logDir: string,
  handle: SampleHandle | undefined
): SampleData => {
  const summaries = useSampleSummaries(logDir, handle?.logFile);
  const summary = useMemo(
    () =>
      handle === undefined
        ? undefined
        : summaries.find(
            (s) => sampleIdsEqual(s.id, handle.id) && s.epoch === handle.epoch
          ),
    [summaries, handle]
  );
  const runningPath = summary?.completed === false;
  const query = useSample(
    logDir,
    !runningPath && summary !== undefined ? handle : undefined,
    summary
  );
  const running = useRunningSample(logDir, handle, summary);
  // The finalized EvalSample a running stream primed; read passively so the
  // completed-path fetch stays owned by useSample.
  const finalizedSample = usePassiveEvalSample(logDir, handle);

  return useMemo(
    () =>
      deriveSampleData({ handle, summary, query, running, finalizedSample }),
    [handle, summary, query, running, finalizedSample]
  );
};

/**
 * The SampleData for a handle iff its EvalSample is resident, else undefined
 * — a passive read that never fetches (see `usePassiveEvalSample` for the
 * cache-rendezvous contract). Absence is a normal answer, not a loading
 * state; the authoritative status for a sample being *shown* is
 * `useSampleData`'s. For surfaces that must stay fetch-free (e.g. the
 * invalidation banner in the title bar).
 */
export const usePassiveSampleData = (
  logDir: string,
  handle: SampleHandle | undefined
): SampleData | undefined => {
  const sample = usePassiveEvalSample(logDir, handle);
  return useMemo(
    () => (sample === undefined ? undefined : settledSampleData(sample)),
    [sample]
  );
};
