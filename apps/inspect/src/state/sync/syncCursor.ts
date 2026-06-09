import { LogHandle } from "@tsmono/inspect-common/types";

export interface SyncCursor {
  mtime: number;
  clientFileCount: number;
  staticList: boolean;
}

// staticList = files cached but no mtimes: incremental sync is impossible, so the caller must force a full fetch.
export function computeSyncCursor(logFiles: LogHandle[]): SyncCursor {
  const mtime = logFiles.reduce(
    (max, file) => Math.max(max, file.mtime || 0),
    0
  );
  return {
    mtime,
    clientFileCount: logFiles.length,
    staticList: logFiles.length > 0 && mtime === 0,
  };
}

// A missing mtime on either side can't be compared, so treat it as changed (invalidate).
export function computeInvalidations(
  remoteLogs: LogHandle[],
  localLogs: LogHandle[]
): LogHandle[] {
  return remoteLogs.filter((remoteLog) => {
    const localCopy = localLogs.find((f) => f.name === remoteLog.name);
    if (!localCopy) return true;
    if (remoteLog.mtime && localCopy.mtime) {
      return remoteLog.mtime > localCopy.mtime;
    }
    return true;
  });
}
