import { useQuery } from "@tanstack/react-query";

import { LogHandle } from "@tsmono/inspect-common/types";

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
  db: DatabaseService | undefined,
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

export const writePreviews = async (
  db: DatabaseService | undefined,
  logDir: string | undefined,
  previews: Record<string, LogPreview>
): Promise<void> => {
  if (db?.opened()) {
    await db.writeLogPreviews(Object.values(previews), Object.keys(previews));
  }
  mergePreviews(logDir, previews);
};

export const writeDetails = async (
  db: DatabaseService | undefined,
  logDir: string | undefined,
  details: Record<string, LogDetails>
): Promise<void> => {
  if (db?.opened()) {
    await db.writeLogDetails(details);
  }
  mergeDetails(logDir, details);
};

export const writeDetail = async (
  db: DatabaseService | undefined,
  logDir: string | undefined,
  name: string,
  details: LogDetails
): Promise<void> => {
  if (db?.opened()) {
    await db.writeLogDetail(name, details);
  }
  mergeDetails(logDir, { [name]: details });
};

export const clearFile = async (
  db: DatabaseService | undefined,
  logDir: string | undefined,
  name: string
): Promise<void> => {
  if (db?.opened()) {
    await db.clearCacheForFile(name);
  }
  evictFile(logDir, name);
};

export const clearPreview = async (
  db: DatabaseService | undefined,
  logDir: string | undefined,
  name: string
): Promise<void> => {
  if (db?.opened()) {
    await db.clearPreviewForFile(name);
  }
  evictPreview(logDir, name);
};

export const clearAll = async (
  db: DatabaseService | undefined,
  logDir: string | undefined
): Promise<void> => {
  if (db?.opened()) {
    await db.clearAllCaches();
  }
  clearCache(logDir);
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
  const { data } = useQuery({
    queryKey: logDetailsKey(logDir),
    queryFn: () => currentDetails(logDir),
    staleTime: Infinity,
  });
  return data ?? EMPTY_DETAILS;
};
