import { FC, ReactNode, useEffect } from "react";

import { PulsingDots } from "@tsmono/react/components";

import * as logsContent from "../../../state/logsContent";
import { useApi, useStore } from "../../../state/store";
import { setLogDir, useLogDirAsync } from "../../server/useLogDir";
import { resolveSingleFileLogDir } from "../../singleFileMode";

import { LogLoadController } from "./LogLoadController";

/**
 * Single-file (direct-load) loader host, and the single-file arm of <LoaderHost>.
 * Mirrors <DirectoryLoaderHost>: it resolves the log dir before rendering
 * children, so consumers below the gate always see a defined `logDir`.
 *
 * The URL-param bootstrap (`?task_file=` / `?log_file=`) resolves + seeds the dir
 * here. The embedded-state (`#logview-state` / VS Code) bootstrap stays in <App>,
 * coupled to the persistent host-message bridge; when it's present this host just
 * waits for <App> to seed the dir.
 */
export const SingleFileLoaderHost: FC<{ children: ReactNode }> = ({
  children,
}) => {
  useSingleFileBootstrap();
  const logRoot = useLogDirAsync();

  if (logRoot.error) {
    return (
      <div className="app-config-gate">
        Failed to load log directory: {logRoot.error.message}
      </div>
    );
  }
  if (logRoot.loading) {
    return (
      <div className="app-config-gate">
        <PulsingDots size="large" text="Loading logs…" />
      </div>
    );
  }

  return (
    <>
      <LogLoadController />
      {children}
    </>
  );
};

const useSingleFileBootstrap = () => {
  const api = useApi();
  const setSelectedLogFile = useStore(
    (state) => state.logsActions.setSelectedLogFile
  );

  useEffect(() => {
    const load = async () => {
      // Embedded state (VS Code) seeds the dir via <App>'s onMessage; defer.
      if (document.getElementById("logview-state")) {
        return;
      }

      const urlParams = new URLSearchParams(window.location.search);

      // If the URL provides a task file, load that.
      const logPath = urlParams.get("task_file");
      // Replace spaces with a '+' sign:
      const resolvedLogPath = logPath ? logPath.replace(" ", "+") : logPath;

      if (resolvedLogPath) {
        const dir = await resolveSingleFileLogDir(resolvedLogPath, api);
        setLogDir(dir);
        logsContent.setHandles(dir, [{ name: resolvedLogPath }]);
      } else {
        // If a log file was passed, select it.
        const log_file = urlParams.get("log_file");
        if (log_file) {
          setLogDir(await resolveSingleFileLogDir(log_file, api));
          setSelectedLogFile(log_file);
        }
      }
    };

    void load();
  }, [api, setSelectedLogFile]);
};
