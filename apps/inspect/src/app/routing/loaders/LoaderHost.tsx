import { FC, ReactNode, useEffect } from "react";

import {
  deactivateReplication,
  syncLogs,
} from "../../../state/replicationControl";
import { useStore } from "../../../state/store";
import { useAppConfig } from "../../server/useAppConfig";

import { LogLoadController } from "./LogLoadController";

/**
 * Mounts the loader machinery for a resolved session. There's no gate here — the
 * top-level `<AppConfigGate>` already awaited the resolved config (incl.
 * `logDir`), so `useLogDir()` resolves synchronously. Mounts the per-log
 * `<LogLoadController>` for both modes; directory-wide replication is the lone
 * dir-mode addition (`loader === "replicator"`), and single-file adds the
 * `?log_file=` selection step (<SelectUrlLogFile>).
 */
export const LoaderMounts: FC<{ children: ReactNode }> = ({ children }) => {
  const { singleFileMode, loader, logDir } = useAppConfig();
  return (
    <>
      {singleFileMode && <SelectUrlLogFile />}
      {loader === "replicator" && (
        <ReplicationController key={logDir} logDir={logDir} />
      )}
      <LogLoadController />
      {children}
    </>
  );
};

/**
 * Owns dir-mode replication lifecycle, keyed on `logDir` so a dir change
 * remounts it — running the old cleanup (stop) before the new mount (start).
 * On mount it activates the per-dir database + replication; on cleanup it stops
 * replication. Returns null.
 */
const ReplicationController: FC<{ logDir: string }> = ({ logDir }) => {
  useEffect(() => {
    syncLogs(logDir).catch((e) => {
      console.error(`Failed to activate replication for ${logDir}`, e);
    });
    return () => deactivateReplication();
  }, [logDir]);

  return null;
};

/**
 * Selects the log named by a `?log_file=` URL param. The dir for that file is
 * resolved by the app-config query (`useAppConfigAsync`); this only sets the
 * selection. The embedded (VS Code) case carries no `?log_file=`, so it no-ops
 * there — <App>'s onMessage owns that selection. Returns null.
 */
const SelectUrlLogFile: FC = () => {
  const setSelectedLogFile = useStore(
    (state) => state.logsActions.setSelectedLogFile
  );
  const logFile = useAppConfig().logFile;

  useEffect(() => {
    if (logFile !== undefined) {
      setSelectedLogFile(logFile);
    }
  }, [logFile, setSelectedLogFile]);

  return null;
};
