import { useEffect } from "react";

import { useSamplesRouteParams } from "../app/routing/url";
import { useLogDir } from "../app/server/useLogDir";
import { isSingleFileMode } from "../app/singleFileMode";

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
  const initLogDir = useStore((state) => state.logsActions.initLogDir);
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
        // Dir mode resolves logDir via the gated query before this route
        // mounts; only single-file mode needs to derive it on demand.
        if (isSingleFileMode && !logDir) {
          await initLogDir();
        }

        // Load the log file
        if (!logs.some((log) => log.name.endsWith(routeLogPath))) {
          await loadLogs(routeLogPath);
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
    initLogDir,
    logDir,
    logs,
    selectedLogFile,
  ]);
};
