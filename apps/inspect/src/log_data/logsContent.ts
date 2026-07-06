import { skipToken, useQuery } from "@tanstack/react-query";

import { LogHandle } from "@tsmono/inspect-common/types";

import { LogDetails, LogHeader, LogPreview } from "../client/api/types";
import { DatabaseService, LogFetchStateRecord } from "../client/database";
import { toLogHeader } from "../client/utils/type-utils";
import { queryClient } from "../state/queryClient";

import { getDatabaseService } from "./databaseServiceInstance";
import type { LogsContentSink } from "./fetchEngine";
import {
  invalidateSamplesListings,
  pushFileSamples,
  removeSamplesListings,
  toSamplesListingRows,
} from "./samplesListing";

/**
 * The log-list content backed by IndexedDB — handles, previews, and headers
 * for a directory — mirrored into the react-query cache so React consumers can
 * subscribe to it. Each collection lives under its own query key, so a preview
 * update doesn't re-render handle-only consumers (and vice versa).
 *
 * Details INGESTION happens here too (`writeDetails`): the transport payload
 * is normalized at this sink — header (plus derived sample facts) into the
 * detail stores, sample summaries into their own store and the samples
 * listing queries (see design/migration/log-data-summaries-entity.md). The
 * cache and per-handle keys carry `LogHeader`, never the payload.
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
const EMPTY_DETAILS: Record<string, LogHeader> = {};

export const logHandlesKey = (logDir: string) =>
  ["log_data", "handles", logDir] as const;
export const logPreviewsKey = (logDir: string) =>
  ["log_data", "previews", logDir] as const;
export const logDetailsKey = (logDir: string) =>
  ["log_data", "details", logDir] as const;
export const logDetailKey = (logDir: string, name: string) =>
  ["log_data", "detail", logDir, name] as const;
export const logFetchStateKey = (logDir: string, name: string) =>
  ["log_data", "fetch_state", logDir, name] as const;

const currentHandles = (logDir: string): LogHandle[] =>
  queryClient.getQueryData<LogHandle[]>(logHandlesKey(logDir)) ?? EMPTY_HANDLES;
const currentPreviews = (logDir: string): Record<string, LogPreview> =>
  queryClient.getQueryData<Record<string, LogPreview>>(
    logPreviewsKey(logDir)
  ) ?? EMPTY_PREVIEWS;
const currentDetails = (logDir: string): Record<string, LogHeader> =>
  queryClient.getQueryData<Record<string, LogHeader>>(logDetailsKey(logDir)) ??
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

export const setHandles = (logDir: string, handles: LogHandle[]): void => {
  queryClient.setQueryData<LogHandle[]>(logHandlesKey(logDir), handles);
};

export const mergePreviews = (
  logDir: string,
  previews: Record<string, LogPreview>
): void => {
  queryClient.setQueryData<Record<string, LogPreview>>(
    logPreviewsKey(logDir),
    (prev) => ({ ...(prev ?? EMPTY_PREVIEWS), ...previews })
  );
};

/**
 * Push a fresh value to a handle's per-handle detail entry WITHOUT creating
 * one: a bulk backfill writing `setQueryData` unconditionally would
 * materialize every log's details in memory, defeating GC. Unobserved /
 * evicted keys re-seed from IndexedDB via the entry's `queryFn` on next
 * mount.
 */
const pushDetail = (logDir: string, name: string, header: LogHeader): void => {
  const key = logDetailKey(logDir, name);
  if (queryClient.getQueryCache().find({ queryKey: key })) {
    queryClient.setQueryData<LogHeader>(key, header);
  }
};

// Dual-write: the whole-dir map is the subsystem-internal listing feed (the
// listing row join and score-schema discovery read it); the guarded
// per-handle pushes keep mounted `useLogDetail` entries fresh.
export const mergeDetails = (
  logDir: string,
  headers: Record<string, LogHeader>
): void => {
  queryClient.setQueryData<Record<string, LogHeader>>(
    logDetailsKey(logDir),
    (prev) => ({ ...(prev ?? EMPTY_DETAILS), ...headers })
  );
  for (const [name, header] of Object.entries(headers)) {
    pushDetail(logDir, name, header);
  }
};

/**
 * Push a fetch-state row into the cache, but ONLY if it is already observed
 * (a query cache entry exists) — a bulk backfill (or a start()-time attempts
 * reset) touches every listed file, and must not materialize a cache entry
 * for handles nobody is looking at. The per-handle key means an unobserved
 * handle's push is simply a no-op, not a leak.
 */
const pushFetchState = (
  logDir: string,
  name: string,
  state: LogFetchStateRecord
): void => {
  const key = logFetchStateKey(logDir, name);
  if (queryClient.getQueryCache().find({ queryKey: key })) {
    queryClient.setQueryData<LogFetchStateRecord>(key, state);
  }
};

export const mergeFetchStates = (
  logDir: string,
  states: Record<string, LogFetchStateRecord>
): void => {
  for (const [name, state] of Object.entries(states)) {
    pushFetchState(logDir, name, state);
  }
};

const evictPreview = (logDir: string, name: string): void => {
  queryClient.setQueryData<Record<string, LogPreview>>(
    logPreviewsKey(logDir),
    (prev) => omitKey(prev, name)
  );
};

const evictFetchState = (logDir: string, name: string): void => {
  queryClient.removeQueries({ queryKey: logFetchStateKey(logDir, name) });
};

const evictFile = (logDir: string, name: string): void => {
  queryClient.setQueryData<LogHandle[]>(logHandlesKey(logDir), (prev) =>
    (prev ?? EMPTY_HANDLES).filter((handle) => handle.name !== name)
  );
  evictPreview(logDir, name);
  queryClient.setQueryData<Record<string, LogHeader>>(
    logDetailsKey(logDir),
    (prev) => omitKey(prev, name)
  );
  queryClient.removeQueries({ queryKey: logDetailKey(logDir, name) });
  evictFetchState(logDir, name);
};

const clearCache = (logDir: string): void => {
  queryClient.setQueryData<LogHandle[]>(logHandlesKey(logDir), EMPTY_HANDLES);
  queryClient.setQueryData<Record<string, LogPreview>>(
    logPreviewsKey(logDir),
    EMPTY_PREVIEWS
  );
  queryClient.setQueryData<Record<string, LogHeader>>(
    logDetailsKey(logDir),
    EMPTY_DETAILS
  );
  // Per-handle keys, not single collections — remove every per-handle detail
  // and fetch-state query under this dir (a prefix match on the query key).
  queryClient.removeQueries({ queryKey: ["log_data", "detail", logDir] });
  queryClient.removeQueries({ queryKey: ["log_data", "fetch_state", logDir] });
  removeSamplesListings(logDir);
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
  logDir: string,
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
  logDir: string,
  previews: Record<string, LogPreview>
): Promise<void> => {
  mergePreviews(logDir, previews);
  if (db?.opened()) {
    await db.writeLogPreviews(Object.values(previews), Object.keys(previews));
  }
};

/**
 * Details INGESTION: normalize each transport payload into the entity
 * stores — header (with derived sample facts) into the detail keys, sample
 * summaries into their own store. Cache updates land synchronously (headers
 * merged, observed file-scope samples listings pushed — the running→complete
 * handoff depends on the status flip and the settled rows arriving in the
 * same update); persistence is one transaction per call; the invalidation
 * sweep then refreshes prefix-scope listings from the committed rows. In
 * db-less sessions the pushes are the only landing spot, and invalidating
 * would clobber them with an empty read — so the sweep is persistence-gated.
 */
export const writeDetails = async (
  db: DatabaseService | null | undefined,
  logDir: string,
  details: Record<string, LogDetails>
): Promise<void> => {
  const headers = Object.fromEntries(
    Object.entries(details).map(([name, payload]) => [
      name,
      toLogHeader(payload),
    ])
  );
  // Samples rows land BEFORE the header merge: the header's status flip is
  // what drops a running log's pending-buffer rows, so a render between the
  // two updates must already have the settled rows.
  await Promise.all(
    Object.entries(details).map(([name, payload]) => {
      const header = headers[name];
      return header === undefined
        ? Promise.resolve()
        : pushFileSamples(
            logDir,
            name,
            toSamplesListingRows(name, header, payload.sampleSummaries)
          );
    })
  );
  mergeDetails(logDir, headers);
  if (db?.opened()) {
    await db.writeLogDetails(details);
    invalidateSamplesListings(logDir);
  }
};

export const writeDetail = async (
  db: DatabaseService | null | undefined,
  logDir: string,
  name: string,
  details: LogDetails
): Promise<void> => writeDetails(db, logDir, { [name]: details });

export const writeFetchStates = async (
  db: DatabaseService | null | undefined,
  logDir: string,
  states: Record<string, LogFetchStateRecord>
): Promise<void> => {
  mergeFetchStates(logDir, states);
  if (db?.opened()) {
    await db.writeFetchStates(states);
  }
};

export const clearFile = async (
  db: DatabaseService | null | undefined,
  logDir: string,
  name: string
): Promise<void> => {
  evictFile(logDir, name);
  if (db?.opened()) {
    await db.clearCacheForFile(name);
  }
  // After the rows are gone (db) — or cache-only (db-less), where a refetch
  // correctly reads empty — refresh any samples listing that carried them.
  invalidateSamplesListings(logDir);
};

export const clearPreview = async (
  db: DatabaseService | null | undefined,
  logDir: string,
  name: string
): Promise<void> => {
  evictPreview(logDir, name);
  if (db?.opened()) {
    await db.clearPreviewForFile(name);
  }
};

export const clearAll = async (
  db: DatabaseService | null | undefined,
  logDir: string
): Promise<void> => {
  clearCache(logDir);
  if (db?.opened()) {
    await db.clearAllCaches();
  }
};

/**
 * The seam as a fetch-engine sink: the write surface bound to a directory and
 * its database. Built at the composition root so the engine stays
 * framework-free (it sees callbacks, not this react-query-backed module).
 */
export const createLogsContentSink = (
  db: DatabaseService | null,
  logDir: string
): LogsContentSink => ({
  setHandles: (handles) => setHandles(logDir, handles),
  mergePreviews: (previews) => mergePreviews(logDir, previews),
  mergeDetails: (details) => mergeDetails(logDir, details),
  writeHandles: (handles) => writeHandles(db, logDir, handles),
  writePreviews: (previews) => writePreviews(db, logDir, previews),
  writeDetails: (details) => writeDetails(db, logDir, details),
  mergeFetchStates: (states) => mergeFetchStates(logDir, states),
  writeFetchStates: (states) => writeFetchStates(db, logDir, states),
  clearFile: (name) => clearFile(db, logDir, name),
  clearPreview: (name) => clearPreview(db, logDir, name),
  clearAll: () => clearAll(db, logDir),
});

// ---------------------------------------------------------------------------
// Readers
// ---------------------------------------------------------------------------

/**
 * Non-React snapshot of the handles (for slice / routing call sites). Tolerates
 * an unresolved dir (returns empty) — non-React code can run before a scope is
 * settled; React readers below the loader gate always have one.
 */
export const getLogHandles = (logDir: string | undefined): LogHandle[] =>
  logDir === undefined ? EMPTY_HANDLES : currentHandles(logDir);

// Callers pass a resolved dir (`useLogDir()`); the loader gate guarantees one
// before any consumer of these mounts.
export const useLogHandles = (logDir: string): LogHandle[] => {
  const { data } = useQuery({
    queryKey: logHandlesKey(logDir),
    queryFn: () => currentHandles(logDir),
    staleTime: Infinity,
  });
  return data ?? EMPTY_HANDLES;
};

export const useLogPreviews = (logDir: string): Record<string, LogPreview> => {
  const { data } = useQuery({
    queryKey: logPreviewsKey(logDir),
    queryFn: () => currentPreviews(logDir),
    staleTime: Infinity,
  });
  return data ?? EMPTY_PREVIEWS;
};

// Subsystem-internal (the listing row join + score-schema discovery); app
// modules consume the joined listing rows instead.
export const useLogHeaders = (logDir: string): Record<string, LogHeader> => {
  const { data: headers } = useQuery({
    queryKey: logDetailsKey(logDir),
    queryFn: () => currentDetails(logDir),
    staleTime: Infinity,
  });
  return headers ?? EMPTY_DETAILS;
};

/**
 * A single handle's fetch-state (retrieval errors/attempts — a domain
 * separate from eval status/error), for detail-path consumers (e.g. a badge
 * on the currently-open log). Unlike `useLogHandles`/`useLogPreviews`/
 * `useLogHeaders`, this is per-handle, not a whole-collection cache mirror:
 * the listing will read fetch-state from IndexedDB directly via paged joins
 * rather than mounting one of these per row. Idles (`skipToken`) without a
 * name. The `queryFn` reads straight from IndexedDB (there is no
 * self-seeded collection to fall back to for a handle nobody has queried
 * yet); once mounted, the query cache entry it creates is what makes this
 * handle's engine pushes (`mergeFetchStates`) observed instead of guarded
 * no-ops.
 */
export const useLogFetchState = (
  logDir: string,
  name: string | undefined
): LogFetchStateRecord | undefined => {
  const { data } = useQuery({
    queryKey: logFetchStateKey(logDir, name ?? ""),
    queryFn:
      name === undefined
        ? skipToken
        : async () => {
            const db = getDatabaseService();
            if (!db.opened()) {
              return null;
            }
            const states = await db.readFetchStates();
            return states[name] ?? null;
          },
    staleTime: Infinity,
  });
  return data ?? undefined;
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
  const match = getLogHandles(logDir).find((handle) =>
    handle.name.endsWith(logFile)
  );
  return match?.name ?? logFile;
};

