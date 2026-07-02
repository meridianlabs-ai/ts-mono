import { useEffect } from "react";

import { sampleHandlesEqual } from "../app/shared/sample";
import { kSampleMessagesTabId } from "../constants";

import { useLogSelection, useSampleData } from "./hooks";
import { getSamplePolling } from "./samplePollingInstance";
import { useStore } from "./store";

// List of virtuoso list keys that should be cleared when sample changes
const SAMPLE_LIST_KEYS = ["transcript-tree"];

/**
 * Reactions to the selected sample changing — no fetching. Completed bodies
 * are fetched by `useSampleQuery` (via `useSampleData`); this hook resets
 * per-sample UI state (scroll/list positions, collapsed events, timeline),
 * prepares/stops the legacy running-sample machinery, and defaults the
 * messages tab for samples with no events.
 *
 * Used to trigger side effects only — returns nothing.
 */
export function useLoadSampleSideEffect() {
  const logSelection = useLogSelection();
  const sampleActions = useStore((state) => state.sampleActions);
  const clearListPosition = useStore(
    (state) => state.appActions.clearListPosition
  );
  const setSampleTab = useStore((state) => state.appActions.setSampleTab);
  const identifier = useStore((state) => state.sample.sample_identifier);
  const sliceStatus = useStore((state) => state.sample.sampleStatus);
  const { sample } = useSampleData();

  const logFile = logSelection.logFile;
  const sampleId = logSelection.sample?.id;
  const sampleEpoch = logSelection.sample?.epoch;
  const sampleCompleted = logSelection.sample?.completed;

  useEffect(() => {
    if (!logFile || sampleId === undefined || sampleEpoch === undefined) {
      return;
    }
    const isSameSample = sampleHandlesEqual(identifier, {
      id: sampleId,
      epoch: sampleEpoch,
      logFile,
    });
    if (sampleCompleted !== false) {
      // Includes the just-finalized stream (completed flips true for the same
      // sample): skip the reset so the finalized body bridges the refetch.
      if (isSameSample) {
        return;
      }
      for (const key of SAMPLE_LIST_KEYS) {
        clearListPosition(key);
      }
      sampleActions.clearCollapsedEvents();
      // Clears legacy slice remnants and scroll/list bags; also stops any
      // running-sample poll from the previous selection.
      sampleActions.prepareForSampleLoad(logFile, sampleId, sampleEpoch);
    } else {
      // Don't reset a stream that's already prepared or in flight for this
      // sample (remounts, effect re-runs on unrelated dep changes).
      const streaming =
        sliceStatus === "loading" || sliceStatus === "streaming";
      const finalized = sampleActions.getSelectedSample() !== undefined;
      if (isSameSample && (streaming || finalized)) {
        return;
      }
      for (const key of SAMPLE_LIST_KEYS) {
        clearListPosition(key);
      }
      sampleActions.prepareForSampleLoad(logFile, sampleId, sampleEpoch);
      // Polling (started by usePollSampleSideEffect) appends into
      // runningEvents; make sure the previous sample's stream is gone.
      sampleActions.clearSampleForPolling(logFile, sampleId, sampleEpoch);
      getSamplePolling().stopPolling();
    }
  }, [
    logFile,
    sampleId,
    sampleEpoch,
    sampleCompleted,
    identifier,
    sliceStatus,
    sampleActions,
    clearListPosition,
  ]);

  // A sample with no events defaults to the messages tab (there's no
  // transcript to show). Mirrors the legacy setSelectedSample behavior for
  // bodies that now arrive via the query.
  useEffect(() => {
    if (sample !== undefined && sample.events.length < 1) {
      setSampleTab(kSampleMessagesTabId);
    }
  }, [sample, setSampleTab]);
}
