import { useCallback } from "react";

import { useStore } from "./store";

/**
 * Clear the selected/loaded log.
 *
 * Used to obtain an action function only — no data, no mount side effects.
 */
export const useUnloadLogAction = () => {
  const clearSelectedLogFile = useStore(
    (state) => state.logsActions.clearSelectedLogFile
  );
  const clearLog = useStore((state) => state.logActions.clearLog);

  const unloadLog = useCallback(() => {
    clearSelectedLogFile();
    clearLog();
  }, [clearLog, clearSelectedLogFile]);
  return { unloadLog };
};
