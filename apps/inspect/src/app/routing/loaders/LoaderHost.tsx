import { FC, ReactNode, useEffect } from "react";

import { AsyncGate } from "@tsmono/react/components";

import {
  activateReplication,
  deactivateReplication,
} from "../../../state/replicationControl";
import { useStore } from "../../../state/store";
import { useLogDir, useLogDirAsync } from "../../server/useLogDir";
import { isSingleFileMode } from "../../singleFileMode";
import { parseUrlLogSource } from "../../urlLogSource";

import { LogLoadController } from "./LogLoadController";

/**
 * Loader gate: resolves the log dir, then renders the loaded content below the
 * gate. Both modes gate on the same `["log-dir"]` query (`useLogDirAsync`) and
 * mount the same per-log `<LogLoadController>` + `children`; the only fork is
 * directory-wide replication, which `isSingleFileMode` toggles off.
 *
 * The log dir itself is resolved by the query (`useLogDir`); the lone extra
 * single-file step is selecting the `?log_file=` log, which <SelectUrlLogFile>
 * owns.
 */
export const LoaderGate: FC<{ children: ReactNode }> = ({ children }) => (
  <>
    {isSingleFileMode && <SelectUrlLogFile />}
    <AsyncGate
      async={useLogDirAsync()}
      errorLabel="Failed to load log directory"
      loadingText="Loading logs…"
    >
      <LoadedContent>{children}</LoadedContent>
    </AsyncGate>
  </>
);

// Below the gate the log dir is resolved, so `useLogDir()` is guaranteed in
// both modes (single-file seeds the same `["log-dir"]` cache). Replication is
// the lone dir-mode addition; everything else is shared.
const LoadedContent: FC<{ children: ReactNode }> = ({ children }) => {
  const logDir = useLogDir();
  return (
    <>
      {!isSingleFileMode && (
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
    activateReplication(logDir).catch((e) => {
      console.error(`Failed to activate replication for ${logDir}`, e);
    });
    return () => deactivateReplication();
  }, [logDir]);

  return null;
};

/**
 * Selects the log named by a `?log_file=` URL param. The dir for that file is
 * resolved by the query (`useLogRootAsync`); this only sets the selection. The
 * embedded (VS Code) case carries no `?log_file=`, so it no-ops there — <App>'s
 * onMessage owns that selection. Returns null.
 */
const SelectUrlLogFile: FC = () => {
  const setSelectedLogFile = useStore(
    (state) => state.logsActions.setSelectedLogFile
  );

  useEffect(() => {
    const source = parseUrlLogSource(window.location.search);
    if (source.kind === "file") {
      setSelectedLogFile(source.logFile);
    }
  }, [setSelectedLogFile]);

  return null;
};
