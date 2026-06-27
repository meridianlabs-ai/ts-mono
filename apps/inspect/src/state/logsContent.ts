import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { LogHandle } from "@tsmono/inspect-common/types";
import { AsyncData, data, loading } from "@tsmono/util";

import { LogDetails, LogPreview } from "../client/api/types";
import { DatabaseService } from "../client/database";

import { queryClient } from "./queryClient";

/**
 * The log-list content backed by IndexedDB — handles, previews, and details for
 * a directory — mirrored into the react-query cache so React consumers can
 * subscribe to it. Each collection lives under its own query key, so a preview
 * update doesn't re-render handle-only consumers (and vice versa).
 *
 * The invariant for this module: IndexedDB is never written without the same
 * write landing in the cache. The `write*` / `clear*` seam below are the only
 * callers of the `DatabaseService` mutators anywhere — each pairs the
 * persistence with its cache update. Cache-only writes (the `set*`/`merge*`
 * primitives) are allowed; the invariant is one-directional (db ⟹ cache).
 *
 * The queries are passive cache containers: `staleTime: Infinity` and a
 * `queryFn` that just returns the current snapshot. The seam (not react-query)
 * owns freshness, driving updates via `setQueryData`.
 */

const EMPTY_HANDLES: LogHandle[] = [];
const EMPTY_PREVIEWS: Record<string, LogPreview> = {};
const EMPTY_DETAILS: Record<string, LogDetails> = {};

export const logHandlesKey = (logDir: string | undefined) =>
  ["log-handles", logDir ?? ""] as const;
export const logPreviewsKey = (logDir: string | undefined) =>
  ["log-previews", logDir ?? ""] as const;
export const logDetailsKey = (logDir: string | undefined) =>
  ["log-details", logDir ?? ""] as const;

const currentHandles = (logDir: string | undefined): LogHandle[] =>
  queryClient.getQueryData<LogHandle[]>(logHandlesKey(logDir)) ?? EMPTY_HANDLES;
const currentPreviews = (
  logDir: string | undefined
): Record<string, LogPreview> =>
  queryClient.getQueryData<Record<string, LogPreview>>(
    logPreviewsKey(logDir)
  ) ?? EMPTY_PREVIEWS;
const currentDetails = (
  logDir: string | undefined
): Record<string, LogDetails> =>
  queryClient.getQueryData<Record<string, LogDetails>>(logDetailsKey(logDir)) ??
  EMPTY_DETAILS;

const omitKey = <T>(
  record: Record<string, T> | undefined,
  key: string
): Record<string, T> | undefined => {
  if (!record || !(key in record)) {
    return record;
  }
  const { [key]: _omitted, ...rest } = record;
  return rest;
};

// ---------------------------------------------------------------------------
// Cache-only primitives. Writing the cache without IndexedDB is allowed (the
// invariant is db ⟹ cache, not the reverse): single-file mode and the
// replicator's preload/activate paths seed the cache from data that is either
// transient or already persisted.
// ---------------------------------------------------------------------------

export const setHandles = (
  logDir: string | undefined,
  handles: LogHandle[]
): void => {
  queryClient.setQueryData<LogHandle[]>(logHandlesKey(logDir), handles);
};

export const mergePreviews = (
  logDir: string | undefined,
  previews: Record<string, LogPreview>
): void => {
  queryClient.setQueryData<Record<string, LogPreview>>(
    logPreviewsKey(logDir),
    (prev) => ({ ...(prev ?? EMPTY_PREVIEWS), ...previews })
  );
};

export const mergeDetails = (
  logDir: string | undefined,
  details: Record<string, LogDetails>
): void => {
  queryClient.setQueryData<Record<string, LogDetails>>(
    logDetailsKey(logDir),
    (prev) => ({ ...(prev ?? EMPTY_DETAILS), ...details })
  );
};

const evictPreview = (logDir: string | undefined, name: string): void => {
  queryClient.setQueryData<Record<string, LogPreview>>(
    logPreviewsKey(logDir),
    (prev) => omitKey(prev, name)
  );
};

const evictFile = (logDir: string | undefined, name: string): void => {
  queryClient.setQueryData<LogHandle[]>(logHandlesKey(logDir), (prev) =>
    (prev ?? EMPTY_HANDLES).filter((handle) => handle.name !== name)
  );
  evictPreview(logDir, name);
  queryClient.setQueryData<Record<string, LogDetails>>(
    logDetailsKey(logDir),
    (prev) => omitKey(prev, name)
  );
};

const clearCache = (logDir: string | undefined): void => {
  queryClient.setQueryData<LogHandle[]>(logHandlesKey(logDir), EMPTY_HANDLES);
  queryClient.setQueryData<Record<string, LogPreview>>(
    logPreviewsKey(logDir),
    EMPTY_PREVIEWS
  );
  queryClient.setQueryData<Record<string, LogDetails>>(
    logDetailsKey(logDir),
    EMPTY_DETAILS
  );
};

// ---------------------------------------------------------------------------
// IndexedDB + cache seam. The only callers of the DatabaseService mutators.
// Each persists to IndexedDB (when a database is open) and mirrors the same
// write into the cache.
// ---------------------------------------------------------------------------

/**
 * Persist `handles` to IndexedDB and cache the resulting full listing. The db
 * write is an upsert (delta) while the cache holds the full re-read, so the
 * full list is read back and returned for the caller's continued sync logic.
 */
export const writeHandles = async (
  db: DatabaseService | null | undefined,
  logDir: string | undefined,
  handles: LogHandle[]
): Promise<LogHandle[]> => {
  if (db?.opened()) {
    await db.writeLogs(handles);
    const all = (await db.readLogs()) ?? handles;
    setHandles(logDir, all);
    return all;
  }
  setHandles(logDir, handles);
  return handles;
};

// The keyed merges and clears update the cache first (it's the read path, and
// the cache value equals the write input), then persist to IndexedDB. So a
// fire-and-forget call still reflects in the cache synchronously.

export const writePreviews = async (
  db: DatabaseService | null | undefined,
  logDir: string | undefined,
  previews: Record<string, LogPreview>
): Promise<void> => {
  mergePreviews(logDir, previews);
  if (db?.opened()) {
    await db.writeLogPreviews(Object.values(previews), Object.keys(previews));
  }
};

export const writeDetails = async (
  db: DatabaseService | null | undefined,
  logDir: string | undefined,
  details: Record<string, LogDetails>
): Promise<void> => {
  mergeDetails(logDir, details);
  if (db?.opened()) {
    await db.writeLogDetails(details);
  }
};

export const writeDetail = async (
  db: DatabaseService | null | undefined,
  logDir: string | undefined,
  name: string,
  details: LogDetails
): Promise<void> => {
  mergeDetails(logDir, { [name]: details });
  if (db?.opened()) {
    await db.writeLogDetail(name, details);
  }
};

export const clearFile = async (
  db: DatabaseService | null | undefined,
  logDir: string | undefined,
  name: string
): Promise<void> => {
  evictFile(logDir, name);
  if (db?.opened()) {
    await db.clearCacheForFile(name);
  }
};

export const clearPreview = async (
  db: DatabaseService | null | undefined,
  logDir: string | undefined,
  name: string
): Promise<void> => {
  evictPreview(logDir, name);
  if (db?.opened()) {
    await db.clearPreviewForFile(name);
  }
};

export const clearAll = async (
  db: DatabaseService | null | undefined,
  logDir: string | undefined
): Promise<void> => {
  clearCache(logDir);
  if (db?.opened()) {
    await db.clearAllCaches();
  }
};

// ---------------------------------------------------------------------------
// Readers
// ---------------------------------------------------------------------------

/** Non-React snapshot of the handles (for slice / routing call sites). */
export const getLogHandles = (logDir: string | undefined): LogHandle[] =>
  currentHandles(logDir);

export const useLogHandles = (logDir: string | undefined): LogHandle[] => {
  const { data } = useQuery({
    queryKey: logHandlesKey(logDir),
    queryFn: () => currentHandles(logDir),
    staleTime: Infinity,
  });
  return data ?? EMPTY_HANDLES;
};

export const useLogPreviews = (
  logDir: string | undefined
): Record<string, LogPreview> => {
  const { data } = useQuery({
    queryKey: logPreviewsKey(logDir),
    queryFn: () => currentPreviews(logDir),
    staleTime: Infinity,
  });
  return data ?? EMPTY_PREVIEWS;
};

export const useLogDetails = (
  logDir: string | undefined
): Record<string, LogDetails> => {
  const { data: details } = useQuery({
    queryKey: logDetailsKey(logDir),
    queryFn: () => currentDetails(logDir),
    staleTime: Infinity,
  });
  return details ?? EMPTY_DETAILS;
};

/**
 * Resolve a log file (which may be a relative name or an absolute path) to the
 * key it is stored under in the per-directory collections — the matching
 * `handle.name`, falling back to the file itself when no handle is present yet
 * (e.g. single-file mode before the listing is seeded). Both readers and the
 * opened-log writers route through this so the opened log lands on the same key
 * the listing uses.
 */
export const resolveLogKey = (
  logDir: string | undefined,
  logFile: string
): string => {
  const match = currentHandles(logDir).find((handle) =>
    handle.name.endsWith(logFile)
  );
  return match?.name ?? logFile;
};

/**
 * The details for a single log, read from the `["log-details", logDir]`
 * collection. `loading` until the row is present (the seam fills it on open and
 * the replicator backfills it in the background); the error branch is required
 * by `AsyncData` but unreachable today — the passive cache has no fetch-error
 * source. See `design/migration/selected-log-details-react-query.md`.
 */
export const useLogDetail = (
  logDir: string | undefined,
  logFile: string | undefined
): AsyncData<LogDetails> => {
  const details = useLogDetails(logDir);
  const handles = useLogHandles(logDir);
  return useMemo(() => {
    if (!logFile) {
      return loading;
    }
    const key =
      handles.find((handle) => handle.name.endsWith(logFile))?.name ?? logFile;
    const detail = details[key];
    return detail ? data(detail) : loading;
  }, [details, handles, logFile]);
};

/** Non-React snapshot of a single log's details (for slice / polling). */
export const getLogDetail = (
  logDir: string | undefined,
  logFile: string
): LogDetails | undefined =>
  currentDetails(logDir)[resolveLogKey(logDir, logFile)];
