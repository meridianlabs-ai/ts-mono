import { FC, ReactNode, useEffect } from "react";

import { PulsingDots } from "@tsmono/react/components";

import { useStore } from "../../../state/store";
import { useLogRootAsync } from "../../server/useLogDir";

/**
 * Dir-mode arm of <LoaderHost>: resolves the server log root once (via the gated
 * `["log-dir"]` query) before rendering `children`, and owns the dir-mode
 * replication lifecycle through <ReplicationController>. Only mounted in
 * directory mode (single-file's log dir is route-derived, and the `["log-dir"]`
 * query is disabled there).
 */
export const DirectoryLoaderHost: FC<{ children: ReactNode }> = ({
  children,
}) => {
  const logRoot = useLogRootAsync();

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

  // Past the loading/error gate, directory mode always has a log dir:
  // view-server always configures one, static-http throws on no root (→ error
  // branch above), and VS Code is asserted single-file in `resolveApi` so it
  // never reaches the directory loader. A missing dir here is a coding error.
  const logDir = logRoot.data?.log_dir;
  if (!logDir) {
    throw new Error(
      "Directory loader resolved without a log_dir; expected a configured root in directory mode."
    );
  }
  return (
    <>
      <ReplicationController key={logDir} logDir={logDir} />
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
  const activateReplication = useStore(
    (state) => state.logsActions.activateReplication
  );
  const deactivateReplication = useStore(
    (state) => state.logsActions.deactivateReplication
  );

  useEffect(() => {
    void activateReplication(logDir);
    return () => deactivateReplication();
  }, [logDir, activateReplication, deactivateReplication]);

  return null;
};
