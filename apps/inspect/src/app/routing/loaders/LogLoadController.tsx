import { FC, useEffect } from "react";

import { kLogViewInfoTabId } from "../../../constants";
import { useSelectedLogDetails } from "../../../state/hooks";
import { getLogPolling } from "../../../state/logPollingInstance";
import { useSelectedLogQuery } from "../../../state/selectedLogDetails";
import { useStore } from "../../../state/store";

/**
 * Reacts to the selected log's details query — only the side effects that
 * can't be derived: recording the loaded log, resetting per-log derived
 * selection state, defaulting the workspace tab for empty logs, and starting
 * polling. All fetching lives in the query/engine. Rendered below the loader
 * gate (by both loader hosts) so the log dir the query is keyed on is
 * resolved before it runs.
 */
export const LogLoadController: FC = () => {
  const selectedLogFile = useStore((state) => state.logs.selectedLogFile);
  const selectedLog = useSelectedLogQuery();
  const details = selectedLog.data;
  const error = selectedLog.error;

  const setLoadedLog = useStore((state) => state.logActions.setLoadedLog);
  const clearSelectedScores = useStore(
    (state) => state.logActions.clearSelectedScores
  );
  const clearPendingSampleSummaries = useStore(
    (state) => state.logActions.clearPendingSampleSummaries
  );
  const setWorkspaceTab = useStore((state) => state.appActions.setWorkspaceTab);
  const setLoading = useStore((state) => state.appActions.setLoading);
  const loadedLog = useStore((state) => state.log.loadedLog);

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
    clearPendingSampleSummaries();
    getLogPolling().startPolling(selectedLogFile);
  }, [
    details,
    selectedLogFile,
    clearSelectedScores,
    setWorkspaceTab,
    setLoadedLog,
    clearPendingSampleSummaries,
  ]);

  // Surface load failures through the app status (the pre-AsyncData error
  // channel the panels read).
  useEffect(() => {
    if (error) {
      console.log(error);
      setLoading(false, error);
    }
  }, [error, setLoading]);

  // Poll a running log (its status can flip via background updates, not just
  // via this query — read the live collection).
  const liveStatus = useSelectedLogDetails()?.status;
  useEffect(() => {
    if (liveStatus === "started" && loadedLog) {
      getLogPolling().startPolling(loadedLog);
    }
  }, [liveStatus, loadedLog]);

  return null;
};
