import { FC, ReactNode, useEffect } from "react";

import { useAppConfig } from "../../../app_config";
import { selectLogFile } from "../../../state/actions";

import { LogLoadController } from "./LogLoadController";
import { SampleLoadController } from "./SampleLoadController";

/**
 * Mounts the loader machinery for a resolved session. There's no gate here — the
 * top-level `<AppConfigGate>` already awaited the resolved config (incl.
 * `logDir`), so `useLogDir()` resolves synchronously. Mounts the per-log
 * `<LogLoadController>` and per-sample `<SampleLoadController>` reaction
 * controllers for both modes; single-file adds the `?log_file=` selection
 * step (<SelectUrlLogFile>). Replication/engine activation is on-demand
 * inside acquisition — nothing to mount for it.
 */
export const LoaderMounts: FC<{ children: ReactNode }> = ({ children }) => {
  const { singleFileMode } = useAppConfig();
  return (
    <>
      {singleFileMode && <SelectUrlLogFile />}
      <LogLoadController />
      <SampleLoadController />
      {children}
    </>
  );
};

/**
 * Selects the log named by a `?log_file=` URL param. The dir for that file is
 * resolved by the app-config query (`useAppConfigAsync`); this only sets the
 * selection. The embedded (VS Code) case carries no `?log_file=`, so it no-ops
 * there — <App>'s onMessage owns that selection. Returns null.
 */
const SelectUrlLogFile: FC = () => {
  const logFile = useAppConfig().logFile;

  useEffect(() => {
    if (logFile !== undefined) {
      selectLogFile(logFile);
    }
  }, [logFile]);

  return null;
};
