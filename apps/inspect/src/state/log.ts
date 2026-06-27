import { useCallback } from "react";

import { useStore } from "./store";

export const useUnloadLog = () => {
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
