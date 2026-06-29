import { FC, ReactNode, useEffect } from "react";

import { AsyncGate } from "@tsmono/react/components";

import {
  activateReplication,
  deactivateReplication,
} from "../../../state/replicationControl";
import { useLogDir, useLogDirAsync } from "../../server/useLogDir";

import { LogLoadController } from "./LogLoadController";

/**
 * Dir-mode arm of <LoaderHost>: resolves the log dir once (via the gated
 * `["log-dir"]` query) before rendering `children`, and owns the dir-mode
 * replication lifecycle through <ReplicationController>. Only mounted in
 * directory mode (single-file's log dir is route-derived, and the `["log-dir"]`
 * query is disabled there).
 */
export const DirectoryLoaderHost: FC<{ children: ReactNode }> = ({
  children,
}) => (
  <AsyncGate
    async={useLogDirAsync()}
    errorLabel="Failed to load log directory"
    loadingText="Loading logs…"
  >
    <DirModeContent>{children}</DirModeContent>
  </AsyncGate>
);

// Below the gate the log dir is resolved, so `useLogDir()` is guaranteed (it
// throws otherwise — a coding error). Directory mode always has one: view-server
// configures it, static-http errors at the gate on no root, and VS Code's
// directory view resolves it via `get_log_root`.
const DirModeContent: FC<{ children: ReactNode }> = ({ children }) => {
  const logDir = useLogDir();
  return (
    <>
      <ReplicationController key={logDir} logDir={logDir} />
      <LogLoadController />
      {children}
    </>
  );
};

/**
 * Owns dir-mode replication lifecycle. Rendered only in `AppLayout`'s dir-mode
 * branch, keyed on `logDir` (`<ReplicationController key={logDir} logDir={logDir} />`)
 * so a dir change remounts it — running the old cleanup (stop) before the new
 * mount (start). On mount it activates the per-dir database + replication; on
 * cleanup it stops replication. Returns null.
 */
const ReplicationController: FC<{ logDir: string }> = ({ logDir }) => {
  useEffect(() => {
    activateReplication(logDir).catch((e) => {
      console.error(`Failed to activate replication for ${logDir}`, e);
    });
    return () => deactivateReplication();
  }, [logDir]);

  return null;
};
