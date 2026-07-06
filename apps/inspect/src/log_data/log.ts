import { skipToken, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";

import { Log, LogFetchState, LogHeader } from "../client/api/types";

import { getDatabaseService } from "./databaseServiceInstance";
import { logKey, useLogs } from "./logsContent";
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
 * One log's entity row as a per-entity, db-backed cache entry. The `queryFn`
 * is the re-seed path only (an evicted/unmounted entry re-reads its
 * IndexedDB row on remount); the sink's guarded pushes own freshness while
 * the entry is observed. `key` must be the resolved row name.
 */
const useLogRow = (
  logDir: string,
  key: string | undefined
): Log | undefined => {
  const { data } = useQuery({
    queryKey: logKey(logDir, key ?? ""),
    // Returns null on a miss — react-query forbids undefined from a queryFn.
    queryFn:
      key === undefined
        ? skipToken
        : async () => {
            const db = getDatabaseService();
            return (db.opened() ? await db.readLogRow(key) : null) ?? null;
          },
    staleTime: Infinity,
    // default gcTime: eviction is desired — IndexedDB re-seeds on remount.
  });
  return data ?? undefined;
};

/**
 * One log at detailed depth: its header, as a tri-state. Mounting is demand:
 * each (dir, file) requests detailed depth from the engine, whose
 * read-through resolves instantly on a cached row and refreshes in the
 * background. Retrieval failures surface from the row's retrieval facts, not
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
export const useLog = (
  logDir: string,
  logFile: string | undefined,
  opts: { demand?: "active" | "passive" } = {}
): LogDataState<LogHeader> => {
  const demand = opts.demand ?? "passive";
  const rows = useLogs(logDir);
  // The queryKey must use the resolved row name so it matches sink pushes.
  const key =
    logFile === undefined
      ? undefined
      : (rows.find((row) => row.name.endsWith(logFile))?.name ?? logFile);
  const row = useLogRow(logDir, key);
  useEffect(() => {
    if (logFile !== undefined) {
      // Failures land in the row's retrieval facts (surfaced below).
      void fetchLog(logDir, logFile, { passive: demand !== "active" }).catch(
        () => {}
      );
    }
  }, [logDir, logFile, demand]);
  return useMemo(() => {
    const header = row?.header;
    const message =
      header === undefined ? row?.details_fetch_error : undefined;
    const error = message !== undefined ? new Error(message) : undefined;
    return {
      data: header,
      loading:
        logFile !== undefined && header === undefined && error === undefined,
      error,
    };
  }, [row, logFile]);
};

/**
 * A single log's retrieval facts (fetch errors/attempts/settled-seq — a
 * domain separate from eval status/error), for detail-path consumers (e.g.
 * a badge on the currently-open log, the load controller's settle guard).
 * Reads the same per-entity row `useLog` does; mounting it is what makes the
 * row's engine pushes observed instead of guarded no-ops. `name` must be the
 * resolved row name; idles without one.
 */
export const useLogFetchState = (
  logDir: string,
  name: string | undefined
): LogFetchState | undefined => useLogRow(logDir, name);
