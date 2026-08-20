import { FC, useEffect } from "react";

import { kMetadataGridKeyPrefix } from "@tsmono/inspect-components/content";
import { kTranscriptOutlineListKey } from "@tsmono/inspect-components/transcript";

import { useStore } from "../../../state/store";

// Whole property bags of per-sample scroll/list snapshots, cleared by prefix.
// VirtualList persists per persistenceKey (the outline's list key, the record
// trees' prefixed keys); "listPosition" is the legacy Virtuoso bag that old
// sessions may still carry.
const kSampleBagKeys = [
  "scrollPosition",
  "listPosition",
  kTranscriptOutlineListKey,
  kMetadataGridKeyPrefix,
];

/**
 * Reacts to the selected sample changing — no fetching (the sample queries are
 * mounted by the detail views through `useSelectedEvalSampleData`). Resets the per-sample
 * UI state that isn't derivable from the new sample: scroll/list positions,
 * collapsed events, and the timeline selection. Keyed on the sample's identity
 * so re-selecting (or a running sample finalizing in place) doesn't reset.
 */
export const SampleLoadController: FC = () => {
  const handle = useStore((state) => state.log.selectedSampleHandle);
  const identity = handle
    ? `${handle.logFile}:${handle.id}:${handle.epoch}`
    : undefined;

  const removeBagsByPrefix = useStore(
    (state) => state.appActions.removeBagsByPrefix
  );
  const clearCollapsedEvents = useStore(
    (state) => state.sampleActions.clearCollapsedEvents
  );
  const setTimelineSelected = useStore(
    (state) => state.sampleActions.setTimelineSelected
  );
  const setActiveTimelineIndex = useStore(
    (state) => state.sampleActions.setActiveTimelineIndex
  );

  useEffect(() => {
    if (identity === undefined) {
      return;
    }
    for (const bag of kSampleBagKeys) {
      removeBagsByPrefix(bag);
    }
    clearCollapsedEvents();
    setTimelineSelected(null);
    setActiveTimelineIndex(0);
  }, [
    identity,
    removeBagsByPrefix,
    clearCollapsedEvents,
    setTimelineSelected,
    setActiveTimelineIndex,
  ]);

  return null;
};
