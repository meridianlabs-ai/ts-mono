import { FC, ReactNode, useEffect } from "react";

import { AsyncGate } from "@tsmono/react/components";

import { useApi, useStore } from "../../../state/store";
import { setLogDir, useLogDirAsync } from "../../server/useLogDir";
import { resolveSingleFileLogDir } from "../../singleFileMode";
import { parseUrlLogSource } from "../../urlLogSource";

import { LogLoadController } from "./LogLoadController";

/**
 * Single-file (direct-load) loader host, and the single-file arm of <LoaderHost>.
 * Mirrors <DirectoryLoaderHost>: it resolves the log dir before rendering
 * children, so consumers below the gate always see a defined `logDir`.
 *
 * The URL-param bootstrap (`?log_file=`) resolves + seeds the dir here. The
 * embedded-state (`#logview-state` / VS Code) bootstrap stays in <App>,
 * coupled to the persistent host-message bridge; when it's present this host just
 * waits for <App> to seed the dir.
 */
export const SingleFileLoaderHost: FC<{ children: ReactNode }> = ({
  children,
}) => {
  useSingleFileBootstrap();
  return (
    <AsyncGate
      async={useLogDirAsync()}
      errorLabel="Failed to load log directory"
      loadingText="Loading logs…"
    >
      <LogLoadController />
      {children}
    </AsyncGate>
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

      // If a log file was passed, select it.
      const source = parseUrlLogSource(window.location.search);
      if (source.kind === "file") {
        setLogDir(await resolveSingleFileLogDir(source.logFile, api));
        setSelectedLogFile(source.logFile);
      }
    };

    void load();
  }, [api, setSelectedLogFile]);
};
