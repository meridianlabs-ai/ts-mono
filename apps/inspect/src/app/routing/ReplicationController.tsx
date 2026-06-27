import { FC, useEffect } from "react";

import { useStore } from "../../state/store";

/**
 * Owns dir-mode replication lifecycle. Rendered only in `AppLayout`'s dir-mode
 * branch, keyed on `logDir` (`<ReplicationController key={logDir} logDir={logDir} />`)
 * so a dir change remounts it — running the old cleanup (stop) before the new
 * mount (start). On mount it activates the per-dir database + replication; on
 * cleanup it stops replication. Returns null.
 */
export const ReplicationController: FC<{ logDir: string }> = ({ logDir }) => {
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
