import { useCallback, useLayoutEffect, useRef } from "react";

import { useStore } from "./store";

export const useUnloadLog = () => {
  const clearSelectedLogDetails = useStore(
    (state) => state.logActions.clearSelectedLogDetails
  );
  const clearSelectedLogFile = useStore(
    (state) => state.logsActions.clearSelectedLogFile
  );
  const clearLog = useStore((state) => state.logActions.clearLog);
  const clearPendingSampleSummaries = useStore(
    (state) => state.logActions.clearPendingSampleSummaries
  );

  const unloadLog = useCallback(() => {
    clearSelectedLogDetails();
    clearSelectedLogFile();
    clearLog();
    clearPendingSampleSummaries();
  }, [
    clearLog,
    clearSelectedLogDetails,
    clearSelectedLogFile,
    clearPendingSampleSummaries,
  ]);
  return { unloadLog };
};

/**
 * Clear log-bound state before paint when routing to another log. Pending
 * summaries live outside selectedLogDetails but are merged into sample lists,
 * so they must be reset with the selected sample/details.
 */
export const useClearStaleLogStateOnNav = (logPath: string | undefined) => {
  const clearSelectedSample = useStore(
    (state) => state.sampleActions.clearSelectedSample
  );
  const clearSelectedLogDetails = useStore(
    (state) => state.logActions.clearSelectedLogDetails
  );
  const clearPendingSampleSummaries = useStore(
    (state) => state.logActions.clearPendingSampleSummaries
  );
  const prevLogPathRef = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    const prevLogPath = prevLogPathRef.current;
    prevLogPathRef.current = logPath;
    if (prevLogPath && logPath && logPath !== prevLogPath) {
      clearSelectedSample();
      clearSelectedLogDetails();
      clearPendingSampleSummaries();
    }
  }, [
    logPath,
    clearSelectedSample,
    clearSelectedLogDetails,
    clearPendingSampleSummaries,
  ]);
};
