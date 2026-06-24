import { useCallback, useEffect, useRef } from "react";

import { EvalSample } from "@tsmono/inspect-common/types";
import { createLogger } from "@tsmono/util";

import { sampleIdsEqual } from "../app/shared/sample";
import { SampleSummary } from "../client/api/types";

import { useLogSelection, useSampleData } from "./hooks";
import { getSamplePolling } from "./samplePollingInstance";
import {
  resolveSample,
  synthesizeErroredSampleFromSummary,
} from "./sampleUtils";
import { useApi, useStore } from "./store";

// List of virtuoso list keys that should be cleared when sample changes
const SAMPLE_LIST_KEYS = ["transcript-tree"];

const log = createLogger("useSampleLoader");

// Generation counter to invalidate stale sample load responses
let loadGeneration = 0;

/**
 * Hook that handles loading samples based on the current log selection.
 * Contains the full sample loading logic that was previously in sampleSlice.loadSample.
 */
export function useLoadSample() {
  const sampleData = useSampleData();
  const logSelection = useLogSelection();

  // Get store state and actions
  const api = useApi();
  const sampleActions = useStore((state) => state.sampleActions);
  const clearListPosition = useStore(
    (state) => state.appActions.clearListPosition
  );
  const getSelectedSample = useStore(
    (state) => state.sampleActions.getSelectedSample
  );
  const selectedSampleHandle = useStore(
    (state) => state.log.selectedSampleHandle
  );
  const summariesLoaded = useStore(
    (state) => state.log.selectedLogDetails !== undefined
  );

  // Set when a speculative (summary-less) fetch returned a cdir miss and
  // we parked in "loading" awaiting the summary. The flag is set *after*
  // the await resolves, so it never marks an in-flight fetch — that lets
  // the effect retry on summary arrival without ever interrupting a
  // download in progress (which would double the bytes transferred).
  const speculativeMissRef = useRef(false);

  // The handle (id/epoch) is set synchronously from the route by
  // selectSample(); the summary (completed/error/...) only resolves
  // once summaries.json (or the journal fallback) has loaded. Keying the
  // load on the handle lets the sample fetch start as soon as the zip's
  // central directory is parsed, in parallel with the summaries read,
  // instead of being serialised behind it.
  const sampleId = selectedSampleHandle?.id;
  const sampleEpoch = selectedSampleHandle?.epoch;
  const sampleCompleted = logSelection.sample?.completed;

  // Track changes over time (updated inside the load effect below)
  const currentSampleCompleted =
    sampleCompleted !== undefined ? sampleCompleted : true;
  const prevRef = useRef<{
    completed?: boolean;
    logFile?: string;
    sampleId?: string | number;
    sampleNeedsReload?: number;
  }>({});

  const loadSample = useCallback(
    async (
      logFile: string,
      id: number | string,
      epoch: number,
      completed: boolean | undefined,
      summary: SampleSummary | undefined
    ) => {
      // Skip if already loading this exact sample. The route-derived
      // id is a string ("1") but setSelectedSample later overwrites
      // sample_identifier.id with the parsed sample's id (number 1),
      // so use the type-coercing comparator.
      const currentId = sampleData.selectedSampleIdentifier;
      const isSameSample =
        sampleIdsEqual(currentId?.id, id) &&
        currentId?.epoch === epoch &&
        currentId?.logFile === logFile;
      const isLoading =
        sampleData.status === "loading" || sampleData.status === "streaming";

      if (isSameSample && isLoading && !speculativeMissRef.current) {
        return;
      }
      speculativeMissRef.current = false;

      // Invalidate any in-flight responses from previous loads
      const thisGeneration = ++loadGeneration;

      // Clear scroll positions for sample-related virtuoso lists
      // This ensures the new sample starts at the top instead of restoring
      // the previous sample's scroll position
      for (const key of SAMPLE_LIST_KEYS) {
        clearListPosition(key);
      }

      // Clear old sample data and prepare for new load in a single state update
      sampleActions.prepareForSampleLoad(logFile, id, epoch);

      try {
        if (completed !== false) {
          log.debug(`LOADING COMPLETED SAMPLE: ${id}-${epoch}`);
          // Stop any existing polling when loading a completed sample
          getSamplePolling().stopPolling();

          sampleActions.setDownloadProgress(undefined);
          const onProgress = (bytesLoaded: number, bytesTotal: number) => {
            sampleActions.setDownloadProgress({
              complete: bytesLoaded,
              total: bytesTotal,
            });
          };

          // When we don't yet have the summary, this is a speculative
          // fetch racing ahead of the summaries load. A cdir miss in
          // that case shouldn't trigger a full uncached reopen — the
          // sample may simply not be in the zip yet (running eval).
          const retryUncached = summary !== undefined;
          const sample: EvalSample | undefined =
            (await api.get_log_sample(
              logFile,
              id,
              epoch,
              onProgress,
              retryUncached
            )) ??
            (summary?.error
              ? synthesizeErroredSampleFromSummary(summary)
              : undefined);
          sampleActions.setDownloadProgress(undefined);
          log.debug(`LOADED COMPLETED SAMPLE: ${id}-${epoch}`);

          // Discard if a newer load has started while we were waiting
          if (thisGeneration !== loadGeneration) {
            log.debug(`Discarding stale sample response: ${id}-${epoch}`);
            return;
          }

          if (sample) {
            const isNewSample =
              !sampleIdsEqual(currentId?.id, id) ||
              currentId?.epoch !== epoch ||
              currentId?.logFile !== logFile;
            if (isNewSample) {
              sampleActions.clearCollapsedEvents();
            }
            const migratedSample = resolveSample(sample);
            sampleActions.setSelectedSample(migratedSample, logFile);
            sampleActions.setSampleStatus("ok");
          } else if (summary === undefined) {
            // Speculative miss: the sample isn't in the (cached)
            // central directory and we don't yet know whether it's
            // completed. Stay in "loading" and flag the miss so the
            // effect retries (or routes to polling / errors) once the
            // summary resolves.
            log.debug(
              `Speculative sample fetch missed for ${id}-${epoch}; awaiting summary`
            );
            speculativeMissRef.current = true;
            return;
          } else {
            sampleActions.setSampleStatus("error");
            throw new Error(
              "Unable to load sample - an unknown error occurred"
            );
          }
        } else {
          log.debug(`PREPARING FOR POLLING RUNNING SAMPLE: ${id}-${epoch}`);
          // Clear the previous sample so component uses runningEvents instead
          // of old sample.events. Polling will be started by useSamplePolling.
          sampleActions.clearSampleForPolling(logFile, id, epoch);
          getSamplePolling().stopPolling();
        }
      } catch (e) {
        sampleActions.setDownloadProgress(undefined);
        sampleActions.setSampleError(e as Error);
        sampleActions.setSampleStatus("error");
      }
    },
    [
      api,
      clearListPosition,
      sampleActions,
      sampleData.selectedSampleIdentifier,
      sampleData.status,
    ]
  );

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = {
      completed: currentSampleCompleted,
      logFile: logSelection.logFile,
      sampleId,
      sampleNeedsReload: sampleData.sampleNeedsReload,
    };
    if (
      logSelection.logFile &&
      sampleId !== undefined &&
      sampleEpoch !== undefined
    ) {
      // Check if the current selection matches what's already loaded
      // AND that we actually have the sample data (not just the identifier).
      // This is important for VSCode reloads where the identifier may be
      // persisted but the actual sample data (stored in a ref) is lost.
      const identifierMatches =
        sampleIdsEqual(sampleData.selectedSampleIdentifier?.id, sampleId) &&
        sampleData.selectedSampleIdentifier?.epoch === sampleEpoch &&
        sampleData.selectedSampleIdentifier?.logFile === logSelection.logFile;
      const hasSampleData = getSelectedSample() !== undefined;
      const isCurrentSampleLoaded = identifierMatches && hasSampleData;

      // Check if we're currently loading
      const isLoading =
        sampleData.status === "loading" || sampleData.status === "streaming";

      // Is there an error?
      const isError = sampleData.status === "error";

      // Check if this is a meaningful change (not just initial render)
      const logFileChanged =
        prev.logFile !== undefined && prev.logFile !== logSelection.logFile;
      const sampleIdChanged =
        prev.sampleId !== undefined && prev.sampleId !== sampleId;
      const completedChanged =
        prev.completed !== undefined &&
        currentSampleCompleted !== prev.completed;
      const needsReloadChanged =
        prev.sampleNeedsReload !== undefined &&
        prev.sampleNeedsReload !== sampleData.sampleNeedsReload;
      // Retry only after a *resolved* miss (the ref is set post-await),
      // never while a speculative fetch is still in flight.
      const summaryArrivedAfterMiss =
        speculativeMissRef.current && logSelection.sample !== undefined;

      // The route-derived id may not exist in this log at all (typo /
      // stale link). Once summaries have loaded and there's still no
      // match, surface an error instead of leaving the speculative miss
      // parked in "loading" forever.
      if (
        speculativeMissRef.current &&
        summariesLoaded &&
        logSelection.sample === undefined &&
        identifierMatches &&
        isLoading
      ) {
        speculativeMissRef.current = false;
        sampleActions.setSampleError(
          new Error(
            `Sample ${sampleId} (epoch ${sampleEpoch}) not found in this log`
          )
        );
        sampleActions.setSampleStatus("error");
        return;
      }

      // Only load if:
      // 1. The current sample is not already loaded AND not currently loading, OR
      // 2. Something meaningful changed (log file, sample ID, completed status, or reload flag)
      const shouldLoad =
        (!isCurrentSampleLoaded && !isLoading && !isError) ||
        logFileChanged ||
        sampleIdChanged ||
        completedChanged ||
        needsReloadChanged ||
        summaryArrivedAfterMiss;

      if (shouldLoad) {
        void loadSample(
          logSelection.logFile,
          sampleId,
          sampleEpoch,
          sampleCompleted,
          logSelection.sample
        );
      }
    }
  }, [
    logSelection.logFile,
    logSelection.sample,
    sampleId,
    sampleEpoch,
    sampleCompleted,
    currentSampleCompleted,
    sampleData.selectedSampleIdentifier,
    sampleData.status,
    sampleData.sampleNeedsReload,
    sampleData.getSelectedSample,
    summariesLoaded,
    sampleActions,
    loadSample,
    getSelectedSample,
  ]);
}
