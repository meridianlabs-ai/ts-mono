import Dexie from "dexie";

import { LogHandle } from "@tsmono/inspect-common";
import { createLogger } from "@tsmono/util";

import { Log, LogFetchState, LogPreview } from "../api/types";
import { maxDepth, PreparedLogDetails, previewTier } from "../utils/type-utils";

import {
  AppDatabase,
  DB_NAME,
  deleteLegacyDatabases,
  fromLogRecord,
  LogRecord,
  SampleSummaryRecord,
  scopePrefix,
  SyncScopeRecord,
  toLogRecord,
} from "./schema";

const log = createLogger("OpenDatabase");

/** Scope of a sample-summaries read: one log file, or every file under a
 *  path prefix. */
export type SampleSummariesScope = { file: string } | { prefix: string };

/** Scope of a log-rows read/clear: every file under a dir. The database is
 *  unified across log dirs, so whole-table reads are never correct — every
 *  listing-level operation names its scope. */
export type LogScope = { prefix: string };

const newRow = (handle: LogHandle): Log => ({
  ...handle,
  depth: "listed",
  preview_attempts: 0,
  details_attempts: 0,
  details_settled_seq: 0,
});

/**
 * The read/write surface over the (single, per-origin) database. Constructed
 * only with a live connection — obtaining one proves an open succeeded, so
 * consumers holding an `OpenDatabase` never need an "is it open?" check
 * (sessions without persistence hold `null` instead; see #518 for the bug
 * class this shape rules out).
 */
export class OpenDatabase {
  private readonly db: AppDatabase;

  constructor(db: AppDatabase) {
    this.db = db;
  }

  /** Open the (unified) database and wrap the live connection. */
  static async open(): Promise<OpenDatabase> {
    if (await AppDatabase.checkVersionMismatch()) {
      log.info("Recreating database due to version mismatch");
      await Dexie.delete(DB_NAME);
    }
    const db = new AppDatabase();
    try {
      await db.open();
      log.debug("Successfully opened database");
      // Pre-unification per-dir databases are dead weight; sweep them in the
      // background. Genuine fire-and-forget: it cannot reject (fully
      // try/caught), and a legacy database held open by an older tab would
      // block its delete until that tab closes.
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      void deleteLegacyDatabases();
      return new OpenDatabase(db);
    } catch (error) {
      log.error("Failed to open database:", error);
      throw error;
    }
  }

  /**
   * Close the underlying connection. Test teardown only (a same-process
   * `Dexie.delete` blocks on an open connection) — production never closes;
   * a handle is valid for the life of the page.
   */
  close(): void {
    this.db.close();
  }

  // === LOG ROWS ===

  /**
   * Upsert the listing identity tier: new files get fresh listed-depth rows;
   * known files update identity fields only (depth, content, and retrieval
   * facts are preserved).
   */
  async writeLogs(handles: LogHandle[]): Promise<void> {
    const db = this.db;
    const now = new Date().toISOString();

    const existingRecords = await db.logs
      .where("file_path")
      .anyOf(handles.map((handle) => handle.name))
      .toArray();
    const existingByPath = new Map(
      existingRecords.map((record) => [record.file_path, record])
    );

    const records = handles.map<LogRecord>((handle) => {
      const existing = existingByPath.get(handle.name);
      return existing
        ? {
            ...existing,
            task: handle.task,
            task_id: handle.task_id,
            mtime: handle.mtime,
            cached_at: now,
          }
        : toLogRecord(newRow(handle), undefined, now);
    });

    log.debug(`Upserting ${records.length} log rows (identity tier)`);
    await db.logs.bulkPut(records);
  }

  async readLogs(scope: LogScope): Promise<Log[] | null> {
    try {
      const db = this.db;
      const records = await db.logs
        .where("file_path")
        .startsWith(scopePrefix(scope.prefix))
        .toArray();

      // Sort by mtime (descending) if present, otherwise maintain insertion
      // order. Note: != null (not !==) catches both null and undefined.
      records.sort((a, b) => {
        if (a.mtime != null && b.mtime != null) return b.mtime - a.mtime;
        if (a.id != null && b.id != null) return a.id - b.id;
        return 0;
      });

      log.debug(`Retrieved ${records.length} log rows`);
      return records.map(fromLogRecord);
    } catch (error) {
      log.error("Error retrieving log rows:", error);
      return null;
    }
  }

  async readLogRow(filePath: string): Promise<Log | null> {
    try {
      const db = this.db;
      const record = await db.logs.where("file_path").equals(filePath).first();
      return record ? fromLogRecord(record) : null;
    } catch (error) {
      log.error(`Error retrieving log row for ${filePath}:`, error);
      return null;
    }
  }

  async readLogRows(filePaths: string[]): Promise<Record<string, Log>> {
    try {
      const db = this.db;
      const records = await db.logs
        .where("file_path")
        .anyOf(filePaths)
        .toArray();
      const result: Record<string, Log> = {};
      for (const record of records) {
        result[record.file_path] = fromLogRecord(record);
      }
      return result;
    } catch (error) {
      log.error("Error retrieving log rows:", error);
      return {};
    }
  }

  /** Merge a set of per-file row patches, creating listed-depth rows for
   *  unknown files (e.g. single-file mode). Depth ratchets, never lowers. */
  private async mergeRows(
    patches: Record<string, Partial<Log>>
  ): Promise<void> {
    const db = this.db;
    const now = new Date().toISOString();
    const files = Object.keys(patches);
    const existing = await db.logs.where("file_path").anyOf(files).toArray();
    const byPath = new Map(
      existing.map((record) => [record.file_path, record])
    );
    const records = files.map<LogRecord>((file) => {
      const patch = patches[file] ?? {};
      const current = byPath.get(file);
      const base =
        current ?? toLogRecord(newRow({ name: file }), undefined, now);
      return {
        ...base,
        ...patch,
        depth: maxDepth(base.depth, patch.depth ?? base.depth),
        file_path: file,
        id: current?.id,
        cached_at: now,
      };
    });
    await db.logs.bulkPut(records);
  }

  // === PREVIEWED TIER ===

  async writeLogPreviews(previews: Record<string, LogPreview>): Promise<void> {
    log.debug(
      `Upserting ${Object.keys(previews).length} log rows (previewed tier)`
    );
    await this.mergeRows(
      Object.fromEntries(
        Object.entries(previews).map(([file, preview]) => [
          file,
          previewTier(preview),
        ])
      )
    );
  }

  // === DETAILED TIER ===

  /**
   * Ingest prepared details payloads (`prepareLogDetails` — the seam
   * normalizes once for both stores): merge the detailed tier into each log
   * row and replace the file's sample summary rows, in one transaction per
   * call so a reader never sees a header whose summary rows are from an
   * older ingestion.
   */
  async writeLogDetails(
    details: Record<string, PreparedLogDetails>
  ): Promise<void> {
    const db = this.db;
    const now = new Date().toISOString();

    const entries = Object.entries(details);
    log.debug(`Ingesting ${entries.length} log details (split)`);
    await db.transaction("rw", db.logs, db.sample_summaries, async () => {
      await this.mergeRows(
        Object.fromEntries(entries.map(([file, { patch }]) => [file, patch]))
      );
      const files = entries.map(([filePath]) => filePath);
      await db.sample_summaries.where("file_path").anyOf(files).delete();
      await db.sample_summaries.bulkPut(
        entries.flatMap(([filePath, { summaries }]) =>
          summaries.map<SampleSummaryRecord>(({ summary, derived }) => ({
            file_path: filePath,
            id: summary.id,
            epoch: summary.epoch,
            summary,
            derived,
            cached_at: now,
          }))
        )
      );
    });
  }

  async readSampleSummaries(
    scope: SampleSummariesScope
  ): Promise<SampleSummaryRecord[]> {
    const db = this.db;
    const collection =
      "file" in scope
        ? db.sample_summaries.where("file_path").equals(scope.file)
        : db.sample_summaries
            .where("file_path")
            .startsWith(scopePrefix(scope.prefix));
    return collection.toArray();
  }

  // === RETRIEVAL FACTS ===

  async writeFetchStates(states: Record<string, LogFetchState>): Promise<void> {
    log.debug(
      `Merging retrieval facts into ${Object.keys(states).length} log rows`
    );
    await this.mergeRows(states);
  }

  // === LIFECYCLE ===

  /**
   * mtime invalidation: the row keeps its identity but drops content and
   * retrieval facts back to listed depth; the file's sample summary rows go
   * with it.
   */
  async resetDepth(filePaths: string[]): Promise<void> {
    const db = this.db;
    const now = new Date().toISOString();
    await db.transaction("rw", db.logs, db.sample_summaries, async () => {
      const records = await db.logs
        .where("file_path")
        .anyOf(filePaths)
        .toArray();
      await db.logs.bulkPut(
        records.map((record) =>
          toLogRecord(
            newRow({
              name: record.file_path,
              task: record.task,
              task_id: record.task_id,
              mtime: record.mtime,
            }),
            record.id,
            now
          )
        )
      );
      await db.sample_summaries.where("file_path").anyOf(filePaths).delete();
    });
  }

  /** Remove a deleted file's row and its sample summaries. */
  async clearCacheForFile(filePath: string): Promise<void> {
    const db = this.db;
    log.debug(`Clearing cache for file: ${filePath}`);

    await Promise.all([
      db.logs.where("file_path").equals(filePath).delete(),
      db.sample_summaries.where("file_path").equals(filePath).delete(),
    ]);
  }

  /**
   * Wipe every table — the "Clear Local Database" escape hatch. Unlike
   * `clearScope`, this reaches rows persisted under names outside any synced
   * scope's namespace (see `namesInScope` in logsContent).
   */
  async clearAllData(): Promise<void> {
    const db = this.db;
    log.debug("Clearing all cached data");
    await db.transaction(
      "rw",
      [db.logs, db.sample_summaries, db.sync_scopes],
      () =>
        Promise.all([
          db.logs.clear(),
          db.sample_summaries.clear(),
          db.sync_scopes.clear(),
        ])
    );
  }

  /**
   * Clear all cached data under a scope: its log rows, their sample
   * summaries, and the scope's sync record. Other scopes' rows are untouched.
   */
  async clearScope(scope: LogScope): Promise<void> {
    const db = this.db;
    const prefix = scopePrefix(scope.prefix);

    log.debug(`Clearing caches under: ${prefix}`);
    // One transaction: a partial failure must not leave rows deleted while a
    // sync record still claims the scope is replicated. The sync_scopes sweep
    // is prefix-based so nested scopes' records go with their rows.
    await db.transaction(
      "rw",
      [db.logs, db.sample_summaries, db.sync_scopes],
      () =>
        Promise.all([
          db.logs.where("file_path").startsWith(prefix).delete(),
          db.sample_summaries.where("file_path").startsWith(prefix).delete(),
          db.sync_scopes.where("prefix").startsWith(prefix).delete(),
        ])
    );
  }

  // === SYNC SCOPES ===
  // Keys are stored in boundary-safe `scopePrefix` form. The get-then-put
  // upserts run in single transactions: the per-origin database is shared
  // across tabs, and an unfenced read-modify-write can overwrite another
  // tab's just-written timestamp.

  /** Record that a scope is active (creating its row on first contact). */
  async touchSyncScope(prefix: string): Promise<void> {
    const db = this.db;
    const key = scopePrefix(prefix);
    const now = new Date().toISOString();
    await db.transaction("rw", db.sync_scopes, async () => {
      const existing = await db.sync_scopes.get(key);
      await db.sync_scopes.put({
        ...existing,
        prefix: key,
        last_accessed: now,
      });
    });
  }

  /** Read a scope's sync record (undefined when never activated). */
  async getSyncScope(prefix: string): Promise<SyncScopeRecord | undefined> {
    const db = this.db;
    return db.sync_scopes.get(scopePrefix(prefix));
  }

  /** Record that a listing sync persisted under a scope. */
  async markScopeSynced(prefix: string): Promise<void> {
    const db = this.db;
    const key = scopePrefix(prefix);
    const now = new Date().toISOString();
    await db.transaction("rw", db.sync_scopes, async () => {
      const existing = await db.sync_scopes.get(key);
      await db.sync_scopes.put({
        prefix: key,
        last_accessed: existing?.last_accessed ?? now,
        last_synced: now,
      });
    });
  }

  /**
   * Get cache statistics for a scope.
   */
  async getCacheStats(scope: LogScope): Promise<{
    logFiles: number;
    logSummaries: number;
    logHeaders: number;
    sampleSummaries: number;
  }> {
    const db = this.db;
    const prefix = scopePrefix(scope.prefix);

    // Index-only counts: this runs throttled but repeatedly during active
    // replication, and a cursor over the range would structured-clone every
    // record (full header included) just to count it.
    const depthCount = (depth: LogRecord["depth"]) =>
      db.logs
        .where("[depth+file_path]")
        .between([depth, prefix], [depth, prefix + "\uffff"])
        .count();
    const [logFiles, previewed, detailed, sampleSummaries] = await Promise.all([
      db.logs.where("file_path").startsWith(prefix).count(),
      depthCount("previewed"),
      depthCount("detailed"),
      db.sample_summaries.where("file_path").startsWith(prefix).count(),
    ]);

    return {
      logFiles,
      logSummaries: previewed + detailed,
      logHeaders: detailed,
      sampleSummaries,
    };
  }
}
