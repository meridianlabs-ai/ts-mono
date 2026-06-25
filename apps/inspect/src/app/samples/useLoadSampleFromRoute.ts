import { useEffect } from "react";

import { useStore } from "../../state/store";

/**
 * Bootstrap log + sample loading for a standalone sample page (print / single
 * event) opened directly by URL, where the normal log-view init hasn't run.
 * Mirrors LogSampleDetailView's init sequence.
 */
export function useLoadSampleFromRoute(
  logPath?: string,
  sampleId?: string,
  epoch?: string
): void {
  const initLogDir = useStore((state) => state.logsActions.initLogDir);
  const setSelectedLogFile = useStore(
    (state) => state.logsActions.setSelectedLogFile
  );
  const syncLogs = useStore((state) => state.logsActions.syncLogs);
  const selectSample = useStore((state) => state.logActions.selectSample);

  useEffect(() => {
    const loadLogAndSample = async () => {
      if (logPath && sampleId && epoch) {
        await initLogDir();
        setSelectedLogFile(logPath);
        void syncLogs();

        const targetEpoch = parseInt(epoch, 10);
        if (!isNaN(targetEpoch)) {
          selectSample(sampleId, targetEpoch, logPath);
        }
      }
    };
    void loadLogAndSample();
  }, [
    logPath,
    sampleId,
    epoch,
    initLogDir,
    setSelectedLogFile,
    syncLogs,
    selectSample,
  ]);
}
