import { FC, useEffect } from "react";

import { kLogViewInfoTabId } from "../../../constants";
import { usePendingSamples } from "../../../state/pendingSamples";
import { useSelectedLogQuery } from "../../../state/selectedLogDetails";
import { useStore } from "../../../state/store";

/**
 * Reacts to the selected log's details query — only the side effects that
 * can't be derived: recording the loaded log, resetting per-log derived
 * selection state, and defaulting the workspace tab for empty logs. All
 * fetching lives in the query/engine. Rendered below the loader gate (by both
 * loader hosts) so the log dir the query is keyed on is resolved before it
 * runs.
 */
export const LogLoadController: FC = () => {
  const selectedLogFile = useStore((state) => state.logs.selectedLogFile);
  const details = useSelectedLogQuery().data;

  const setLoadedLog = useStore((state) => state.logActions.setLoadedLog);
  const clearSelectedScores = useStore(
    (state) => state.logActions.clearSelectedScores
  );
  const setWorkspaceTab = useStore((state) => state.appActions.setWorkspaceTab);

  // Keep the running log's sample-buffer poll mounted for the whole time a
  // log is open, so polling never depends on which consumer tab is visible.
  usePendingSamples();

  // React to (re)loaded details: the effect re-runs when the query settles
  // with a fresh object — initial load and refresh-by-invalidation alike.
  useEffect(() => {
    if (!selectedLogFile || !details) {
      return;
    }
    clearSelectedScores();
    if (details.status !== "started" && details.sampleSummaries.length === 0) {
      // If there are no samples, use the info tab by default
      setWorkspaceTab(kLogViewInfoTabId);
    }
    setLoadedLog(selectedLogFile);
  }, [
    details,
    selectedLogFile,
    clearSelectedScores,
    setWorkspaceTab,
    setLoadedLog,
  ]);

  return null;
};
