import { FC, useEffect } from "react";

import { useSelectedLogDetails } from "../../../state/hooks";
import { loadLog } from "../../../state/logLoad";
import { useStore } from "../../../state/store";

/**
 * Drives loading + polling of the selected log. Rendered below the loader gate
 * (by both loader hosts) so the log dir is resolved before it runs: it reads
 * the opened log's details from react-query, which is keyed by that dir. Living
 * above the gate (as this used to, in <App>) would force those reads to tolerate
 * an unresolved dir. Returns null.
 */
export const LogLoadController: FC = () => {
  const selectedLogFile = useStore((state) => state.logs.selectedLogFile);
  const loadedLogFile = useStore((state) => state.log.loadedLog);
  const selectedLogDetails = useSelectedLogDetails();
  const setLoading = useStore((state) => state.appActions.setLoading);
  const pollLog = useStore((state) => state.logActions.pollLog);

  // Load the selected log when it changes (unless it's already the loaded one
  // and we have its details).
  useEffect(() => {
    const loadSpecificLog = async () => {
      if (!selectedLogFile) {
        return;
      }
      if (selectedLogFile === loadedLogFile && selectedLogDetails) {
        return;
      }
      try {
        setLoading(true);
        await loadLog(selectedLogFile);
        setLoading(false);
      } catch (e) {
        console.log(e);
        setLoading(false, e as Error);
      }
    };

    void loadSpecificLog();
  }, [selectedLogFile, loadedLogFile, selectedLogDetails, setLoading]);

  // Poll a running log.
  useEffect(() => {
    if (selectedLogDetails?.status === "started") {
      void pollLog();
    }
  }, [pollLog, selectedLogDetails?.status]);

  return null;
};
