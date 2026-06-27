import { FC, useEffect } from "react";

import * as logsContent from "../../state/logsContent";
import { useStore } from "../../state/store";
import { getLogDir } from "../server/useLogDir";

/**
 * Owns the single-file (direct-load) bootstrap: the legacy URL-param path
 * (`?task_file=` / `?log_file=`) that selects the one log to view. Rendered only
 * in single-file mode (by <LoaderHost>), mirroring <ReplicationController> for
 * the directory loader. The embedded-state (`#logview-state` / VS Code)
 * bootstrap stays in <App>, coupled to the persistent host-message bridge; when
 * it's present this controller defers to it. Returns null.
 */
export const DirectLoadController: FC = () => {
  const setLogDir = useStore((state) => state.logsActions.setLogDir);
  const initLogDir = useStore((state) => state.logsActions.initLogDir);
  const setSelectedLogFile = useStore(
    (state) => state.logsActions.setSelectedLogFile
  );

  useEffect(() => {
    const load = async () => {
      // Embedded state (VS Code) is handled by <App>; defer to it.
      if (document.getElementById("logview-state")) {
        return;
      }

      const urlParams = new URLSearchParams(window.location.search);

      // If the URL provides a task file, load that.
      const logPath = urlParams.get("task_file");
      // Replace spaces with a '+' sign:
      const resolvedLogPath = logPath ? logPath.replace(" ", "+") : logPath;

      if (resolvedLogPath) {
        // Clear any log dir, then load just the passed file.
        setLogDir(undefined);
        logsContent.setLogHandles(getLogDir(), [{ name: resolvedLogPath }]);
      } else {
        // If a log file was passed, select it.
        const log_file = urlParams.get("log_file");
        if (log_file) {
          await initLogDir();
          setSelectedLogFile(log_file);
        }
      }
    };

    void load();
  }, [setLogDir, initLogDir, setSelectedLogFile]);

  return null;
};
