import { useQuery } from "@tanstack/react-query";

import { LogHandle } from "@tsmono/inspect-common/types";

import {
  Log,
  LogDetails,
  LogFetchState,
  LogPreview,
} from "../client/api/types";
import { DatabaseService } from "../client/database";
import {
  detailTier,
  maxDepth,
  previewTier,
  toLogHeader,
} from "../client/utils/type-utils";
import { queryClient } from "../state/queryClient";

import type { LogsContentSink } from "./fetchEngine";
import {
  invalidateSamplesListings,
  pushFileSamples,
  removeSamplesListings,
  toSamplesListingRows,
} from "./samplesListing";

/**
 * The Log entity content backed by IndexedDB — one ordered row collection per
 * directory plus one per-entity key per log — mirrored into the react-query
 * cache so React consumers can subscribe. Depth is a column on the row; the
 * acquisition tiers exist only in how the write verbs below are named after
 * the payloads the engine fetches.
 *
 * The invariant for this module: IndexedDB is never written without the same
 * write landing in the cache. The `write*` / `clear*` / `reset*` seam below
 * are the only callers of the `DatabaseService` mutators anywhere — each
 * pairs the persistence with its cache update. Cache-only writes (the
 * `set*`/`merge*`/`seed*` primitives) are allowed; the invariant is
 * one-directional (db ⟹ cache).
 */

const EMPTY_LOGS: Log[] = [];

export const logsKey = (logDir: string) =>
  ["log_data", "logs", logDir] as const;
export const logKey = (logDir: string, name: string) =>
  ["log_data", "log", logDir, name] as const;

const currentLogs = (logDir: string): Log[] =>
  queryClient.getQueryData<Log[]>(logsKey(logDir)) ?? EMPTY_LOGS;

const newRow = (handle: LogHandle): Log => ({
  ...handle,
  depth: "listed",
  preview_attempts: 0,
  details_attempts: 0,
  details_settled_seq: 0,
});

/**
 * Push a fresh row to a log's per-entity entry WITHOUT creating one: a bulk
 * backfill writing `setQueryData` unconditionally would materialize every
 * row in memory, defeating GC. Unobserved / evicted keys re-seed from
 * IndexedDB via the entry's `queryFn` on next mount.
 */
const pushLog = (logDir: string, row: Log): void => {
  const key = logKey(logDir, row.name);
  if (queryClient.getQueryCache().find({ queryKey: key })) {
    queryClient.setQueryData<Log>(key, row);
  }
};

// ---------------------------------------------------------------------------
// Cache-only primitives. Writing the cache without IndexedDB is allowed (the
// invariant is db ⟹ cache, not the reverse): single-file mode and the
// engine's seed/activate paths carry data that is either transient or
// already persisted.
// ---------------------------------------------------------------------------

/** Replace the collection with `rows` (already-complete Log rows, e.g. read
 *  back from the store) and refresh their observed per-entity entries. */
export const setRows = (logDir: string, rows: Log[]): void => {
  queryClient.setQueryData<Log[]>(logsKey(logDir), rows);
  for (const row of rows) {
    pushLog(logDir, row);
  }
};

/**
 * Activate a listing (cache-only): known files keep their depth/content and
 * update identity fields; unknown files start at listed depth. Row order
 * follows `handles`.
 */
export const setListing = (logDir: string, handles: LogHandle[]): void => {
  const byName = new Map(currentLogs(logDir).map((row) => [row.name, row]));
  setRows(
    logDir,
    handles.map((handle) => {
      const existing = byName.get(handle.name);
      return existing ? { ...existing, ...handle } : newRow(handle);
    })
  );
};

/** Merge per-file row patches into the collection (appending rows for
 *  unknown files) and refresh observed per-entity entries. Depth ratchets. */
const mergePatches = (
  logDir: string,
  patches: Record<string, Partial<Log>>
): void => {
  const rows = currentLogs(logDir);
  const seen = new Set<string>();
  const next = rows.map((row) => {
    const patch = patches[row.name];
    if (patch === undefined) {
      return row;
    }
    seen.add(row.name);
    return {
      ...row,
      ...patch,
      depth: maxDepth(row.depth, patch.depth ?? row.depth),
    };
  });
  for (const [name, patch] of Object.entries(patches)) {
    if (!seen.has(name)) {
      next.push({ ...newRow({ name }), ...patch });
    }
  }
  queryClient.setQueryData<Log[]>(logsKey(logDir), next);
  for (const row of next) {
    if (row.name in patches) {
      pushLog(logDir, row);
    }
  }
};

export const mergePreviews = (
  logDir: string,
  previews: Record<string, LogPreview>
): void => {
  mergePatches(
    logDir,
    Object.fromEntries(
      Object.entries(previews).map(([name, preview]) => [
        name,
        previewTier(preview),
      ])
    )
  );
};

/**
 * Push retrieval facts into observed per-entity entries only — the listing
 * collection is deliberately NOT rewritten (fetch outcomes stream during
 * backfill and would churn every listing subscriber; rows omit retrieval
 * facts from the UI anyway). The collection's copy of these columns catches
 * up on the next row write.
 */
export const mergeFetchStates = (
  logDir: string,
  states: Record<string, LogFetchState>
): void => {
  const byName = new Map(currentLogs(logDir).map((row) => [row.name, row]));
  for (const [name, state] of Object.entries(states)) {
    const key = logKey(logDir, name);
    if (!queryClient.getQueryCache().find({ queryKey: key })) {
      continue;
    }
    const current =
      queryClient.getQueryData<Log | null>(key) ?? byName.get(name);
    if (current) {
      queryClient.setQueryData<Log>(key, { ...current, ...state });
    }
  }
};

const evictFile = (logDir: string, name: string): void => {
  queryClient.setQueryData<Log[]>(logsKey(logDir), (prev) =>
    (prev ?? EMPTY_LOGS).filter((row) => row.name !== name)
  );
  queryClient.removeQueries({ queryKey: logKey(logDir, name) });
};

const clearCache = (logDir: string): void => {
  queryClient.setQueryData<Log[]>(logsKey(logDir), EMPTY_LOGS);
  // Per-entity keys are a prefix match, not a single collection.
  queryClient.removeQueries({ queryKey: ["log_data", "log", logDir] });
  removeSamplesListings(logDir);
};

// ---------------------------------------------------------------------------
// IndexedDB + cache seam. The only callers of the DatabaseService mutators.
// Each persists to IndexedDB (when a database is open) and mirrors the same
// write into the cache.
// ---------------------------------------------------------------------------

/**
 * Persist the listing identity tier and cache the resulting full row list.
 * The db write is a merge-upsert (rows keep depth/content) and the cache
 * holds the full re-read, so the full list is read back and returned for the
 * caller's continued sync logic.
 */
export const writeListing = async (
  db: DatabaseService | null | undefined,
  logDir: string,
  handles: LogHandle[]
): Promise<Log[]> => {
  if (db?.opened()) {
    await db.writeLogs(handles);
    const all = await db.readLogs();
    if (all) {
      setRows(logDir, all);
      return all;
    }
  }
  setListing(logDir, handles);
  return currentLogs(logDir);
};

// The keyed merges update the cache first (it's the read path, and the cache
// value equals the write input), then persist to IndexedDB. So a
// fire-and-forget call still reflects in the cache synchronously.

export const writePreviews = async (
  db: DatabaseService | null | undefined,
  logDir: string,
  previews: Record<string, LogPreview>
): Promise<void> => {
  mergePreviews(logDir, previews);
  if (db?.opened()) {
    await db.writeLogPreviews(previews);
  }
};

/**
 * Details INGESTION: normalize each transport payload into the entity
 * stores — the detailed tier onto the log row, sample summaries into their
 * own store. Cache updates land synchronously; samples rows land BEFORE the
 * row merge (the status flip is what drops a running log's pending-buffer
 * rows, so a render between the two updates must already have the settled
 * rows). Persistence is one transaction per call; the invalidation sweep
 * then refreshes prefix-scope listings from the committed rows. In db-less
 * sessions the pushes are the only landing spot, and invalidating would
 * clobber them with an empty read — so the sweep is persistence-gated.
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
  mergePatches(
    logDir,
    Object.fromEntries(
      Object.entries(headers).map(([name, header]) => [
        name,
        detailTier(header),
      ])
    )
  );
  if (db?.opened()) {
    await db.writeLogDetails(details);
    invalidateSamplesListings(logDir);
  }
};

export const writeFetchStates = async (
  db: DatabaseService | null | undefined,
  logDir: string,
  states: Record<string, LogFetchState>
): Promise<void> => {
  mergeFetchStates(logDir, states);
  if (db?.opened()) {
    await db.writeFetchStates(states);
  }
};

/**
 * mtime invalidation: each row keeps its identity but drops content and
 * retrieval facts back to listed depth; its sample summaries go with it.
 * A row REPLACEMENT, not a patch — `mergePatches`' depth ratchet must not
 * apply to explicit resets.
 */
export const resetDepth = async (
  db: DatabaseService | null | undefined,
  logDir: string,
  names: string[]
): Promise<void> => {
  const nameSet = new Set(names);
  const next = currentLogs(logDir).map((row) =>
    nameSet.has(row.name)
      ? newRow({
          name: row.name,
          task: row.task,
          task_id: row.task_id,
          mtime: row.mtime,
        })
      : row
  );
  queryClient.setQueryData<Log[]>(logsKey(logDir), next);
  for (const row of next) {
    if (nameSet.has(row.name)) {
      pushLog(logDir, row);
    }
  }
  if (db?.opened()) {
    await db.resetDepth(names);
  }
  invalidateSamplesListings(logDir);
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
  seedRows: (rows) => setRows(logDir, rows),
  setListing: (handles) => setListing(logDir, handles),
  mergePreviews: (previews) => mergePreviews(logDir, previews),
  writeListing: (handles) => writeListing(db, logDir, handles),
  writePreviews: (previews) => writePreviews(db, logDir, previews),
  writeDetails: (details) => writeDetails(db, logDir, details),
  mergeFetchStates: (states) => mergeFetchStates(logDir, states),
  writeFetchStates: (states) => writeFetchStates(db, logDir, states),
  resetDepth: (names) => resetDepth(db, logDir, names),
  clearFile: (name) => clearFile(db, logDir, name),
  clearAll: () => clearAll(db, logDir),
});

// ---------------------------------------------------------------------------
// Readers
// ---------------------------------------------------------------------------

/**
 * Non-React snapshot of the rows (for slice / routing call sites). Tolerates
 * an unresolved dir (returns empty) — non-React code can run before a scope
 * is settled; React readers below the loader gate always have one.
 */
export const getLogRows = (logDir: string | undefined): Log[] =>
  logDir === undefined ? EMPTY_LOGS : currentLogs(logDir);

// Callers pass a resolved dir (`useLogDir()`); the loader gate guarantees one
// before any consumer of these mounts.
export const useLogs = (logDir: string): Log[] => {
  const { data } = useQuery({
    queryKey: logsKey(logDir),
    queryFn: () => currentLogs(logDir),
    staleTime: Infinity,
  });
  return data ?? EMPTY_LOGS;
};

/**
 * Resolve a log file (which may be a relative name or an absolute path) to the
 * key it is stored under in the per-directory collections — the matching
 * row name, falling back to the file itself when no row is present yet
 * (e.g. single-file mode before the listing is seeded). Both readers and the
 * opened-log writers route through this so the opened log lands on the same key
 * the listing uses.
 */
export const resolveLogKey = (
  logDir: string | undefined,
  logFile: string
): string => {
  const match = getLogRows(logDir).find((row) => row.name.endsWith(logFile));
  return match?.name ?? logFile;
};
