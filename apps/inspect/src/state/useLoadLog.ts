import { useEffect } from "react";

import { useSamplesRouteParams } from "../app/routing/url";
import { useLogDir } from "../app/server/useLogDir";

import { useLogs } from "./hooks";
import { useLogHandles } from "./logsContent";
import { useStore } from "./store";

// Load the log file and select the sample
export const useLoadLog = () => {
  const {
    samplesPath: routeLogPath,
    sampleId,
    epoch,
  } = useSamplesRouteParams();
  const { loadLogs } = useLogs();
  const selectSample = useStore((state) => state.logActions.selectSample);
  const selectedLogFile = useStore((state) => state.logs.selectedLogFile);
  const logDir = useLogDir();
  const logs = useLogHandles(logDir);
  const setSelectedLogFile = useStore(
    (state) => state.logsActions.setSelectedLogFile
  );

  useEffect(() => {
    const exec = async () => {
      if (routeLogPath && sampleId && epoch) {
        // Load the log file
        if (!logs.some((log) => log.name.endsWith(routeLogPath))) {
          await loadLogs();
        }

        if (selectedLogFile !== routeLogPath) {
          setSelectedLogFile(routeLogPath);
        }

        // Select the specific sample
        const targetEpoch = parseInt(epoch, 10);
        selectSample(sampleId, targetEpoch, routeLogPath);
      }
    };

    void exec();
  }, [
    routeLogPath,
    sampleId,
    epoch,
    loadLogs,
    setSelectedLogFile,
    selectSample,
    logDir,
    logs,
    selectedLogFile,
  ]);
};
