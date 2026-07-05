import { skipToken, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";

import { LogDetails } from "../client/api/types";

import { getDatabaseService } from "./databaseServiceInstance";
import { logDetailKey, useLogFetchState, useLogHandles } from "./logsContent";
import { fetchLog } from "./replicationControl";

/**
 * Tri-state for db-backed log data. `error` is a RETRIEVAL (fetch) error —
 * eval errors are inside `data`.
 */
export interface LogDataState<T> {
  data: T | undefined;
  /** File specified, no data yet, no retrieval error. */
  loading: boolean;
  error: Error | undefined;
}

/**
 * One log's details as a per-handle, db-backed cache entry. The `queryFn` is
 * the re-seed path only (an evicted/unmounted entry re-reads its IndexedDB
 * row on remount); the engine's sink pushes own freshness while the entry is
 * observed. Mounting is demand: each (dir, file) triggers an engine fetch,
 * whose read-through resolves instantly on a cached row and refreshes in the
 * background. Retrieval failures surface from the handle's fetch-state, not
 * from the query.
 *
 * `opts.demand` distinguishes WHO is asking: `"active"` (default `"passive"`)
 * declares "someone is looking at this log" — only the selection binding
 * (`useSelectedLogDetail`) uses it. Every other mount (sample-adjacent hooks:
 * summaries, pending-samples, running-sample) just needs the data to exist,
 * so it stays passive — ensure-presence only, never bumping
 * `details_settled_seq` or forcing a server-cache-bypassing refresh. Without
 * this split, switching tabs (mounting a passive consumer for the
 * ALREADY-selected log) would refire `LogLoadController` as if a new log had
 * loaded.
 */
export const useLogDetail = (
  logDir: string,
  logFile: string | undefined,
  opts: { demand?: "active" | "passive" } = {}
): LogDataState<LogDetails> => {
  const demand = opts.demand ?? "passive";
  const handles = useLogHandles(logDir);
  // The queryKey must use the resolved handle name so it matches sink pushes.
  const key =
    logFile === undefined
      ? undefined
      : (handles.find((handle) => handle.name.endsWith(logFile))?.name ??
        logFile);
  const { data } = useQuery({
    queryKey: logDetailKey(logDir, key ?? ""),
    // Returns null on a miss — react-query forbids undefined from a queryFn.
    queryFn:
      key === undefined
        ? skipToken
        : async () => {
            const db = getDatabaseService();
            return (
              (db.opened() ? await db.readLogDetailsForFile(key) : null) ?? null
            );
          },
    staleTime: Infinity,
    // default gcTime: eviction is desired — IndexedDB re-seeds on remount.
  });
  const fetchState = useLogFetchState(logDir, key);
  useEffect(() => {
    if (logFile !== undefined) {
      // Failures land in fetch-state (surfaced below), not here.
      void fetchLog(logDir, logFile, { passive: demand !== "active" }).catch(
        () => {}
      );
    }
  }, [logDir, logFile, demand]);
  return useMemo(() => {
    const detail = data ?? undefined;
    const message =
      detail === undefined ? fetchState?.details_fetch_error : undefined;
    const error = message !== undefined ? new Error(message) : undefined;
    return {
      data: detail,
      loading:
        logFile !== undefined && detail === undefined && error === undefined,
      error,
    };
  }, [data, fetchState, logFile]);
};
