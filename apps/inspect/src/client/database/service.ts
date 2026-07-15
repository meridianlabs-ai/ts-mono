import { LogHandle } from "@tsmono/inspect-common";
import { createLogger } from "@tsmono/util";

import { Log, LogDetails, LogFetchState, LogPreview } from "../api/types";
import {
  detailTier,
  maxDepth,
  previewTier,
  toLogHeader,
} from "../utils/type-utils";

import { DatabaseManager } from "./manager";
import {
  AppDatabase,
  fromLogRecord,
  LogRecord,
  SampleSummaryRecord,
  toLogRecord,
} from "./schema";

const log = createLogger("DatabaseService");

/** Scope of a sample-summaries read: one log file, or every file under a
 *  path prefix. */
export type SampleSummariesScope = { file: string } | { prefix: string };

const newRow = (handle: LogHandle): Log => ({
  ...handle,
  depth: "listed",
  preview_attempts: 0,
  details_attempts: 0,
  details_settled_seq: 0,
});

/**
 * Database service for caching and retrieving log data.
 * Works with a DatabaseManager instance to handle database operations.
 */
export class DatabaseService {
  private manager: DatabaseManager;

  constructor(manager: DatabaseManager) {
    this.manager = manager;
  }

  /**
   * Get the current database instance.
   * Throws an error if no database is open.
   */
  private getDb(): AppDatabase {
    const db = this.manager.getDatabase();
    if (!db) {
      throw new Error("No database initialized. Call openDatabase first.");
    }
    return db;
  }

  opened(): boolean {
    return this.manager.getDatabase() !== null;
  }

  /**
   * Open a database for the specified log directory.
   */
  async openDatabase(databaseHandle: string): Promise<void> {
    await this.manager.openDatabase(databaseHandle);
  }

  /**
   * Close the current database connection.
   */
  async closeDatabase(): Promise<void> {
    await this.manager.close();
  }

  /**
   * Get the current log directory.
   */
  getDatabaseHandle(): string | null {
    return this.manager.getDatabaseHandle();
  }

  // === LOG ROWS ===

  /**
   * Upsert the listing identity tier: new files get fresh listed-depth rows;
   * known files update identity fields only (depth, content, and retrieval
   * facts are preserved).
   */
  async writeLogs(handles: LogHandle[]): Promise<void> {
    const db = this.getDb();
    const now = new Date().toISOString();

    const existingRecords = await db.logs.toArray();
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

  async readLogs(): Promise<Log[] | null> {
    try {
      if (!this.opened()) {
        log.debug("Database not open");
        return null;
      }

      const db = this.getDb();
      const records = await db.logs.toArray();

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
      const db = this.getDb();
      const record = await db.logs.where("file_path").equals(filePath).first();
      return record ? fromLogRecord(record) : null;
    } catch (error) {
      log.error(`Error retrieving log row for ${filePath}:`, error);
      return null;
    }
  }

  async readLogRows(filePaths: string[]): Promise<Record<string, Log>> {
    try {
      const db = this.getDb();
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
    const db = this.getDb();
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
   * Ingest details payloads: merge the detailed tier into each log row and
   * replace the file's sample summary rows, in one transaction per call so a
   * reader never sees a header whose summary rows are from an older
   * ingestion.
   */
  async writeLogDetails(details: Record<string, LogDetails>): Promise<void> {
    const db = this.getDb();
    const now = new Date().toISOString();

    const entries = Object.entries(details);
    log.debug(`Ingesting ${entries.length} log details (split)`);
    await db.transaction("rw", db.logs, db.sample_summaries, async () => {
      await this.mergeRows(
        Object.fromEntries(
          entries.map(([file, payload]) => [
            file,
            detailTier(toLogHeader(payload)),
          ])
        )
      );
      const files = entries.map(([filePath]) => filePath);
      await db.sample_summaries.where("file_path").anyOf(files).delete();
      await db.sample_summaries.bulkPut(
        entries.flatMap(([filePath, payload]) =>
          payload.sampleSummaries.map<SampleSummaryRecord>((summary) => ({
            file_path: filePath,
            id: summary.id,
            epoch: summary.epoch,
            summary,
            cached_at: now,
          }))
        )
      );
    });
  }

  async readSampleSummaries(
    scope: SampleSummariesScope
  ): Promise<SampleSummaryRecord[]> {
    const db = this.getDb();
    const collection =
      "file" in scope
        ? db.sample_summaries.where("file_path").equals(scope.file)
        : db.sample_summaries.where("file_path").startsWith(scope.prefix);
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
    const db = this.getDb();
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
    const db = this.getDb();
    log.debug(`Clearing cache for file: ${filePath}`);

    await Promise.all([
      db.logs.where("file_path").equals(filePath).delete(),
      db.sample_summaries.where("file_path").equals(filePath).delete(),
    ]);
  }

  /**
   * Clear all cached data from all tables.
   */
  async clearAllCaches(): Promise<void> {
    const db = this.getDb();

    log.debug("Clearing all caches");
    await Promise.all([db.logs.clear(), db.sample_summaries.clear()]);
  }

  /**
   * Get cache statistics.
   */
  async getCacheStats(): Promise<{
    logFiles: number;
    logSummaries: number;
    logHeaders: number;
    sampleSummaries: number;
    logHandle: string | null;
  }> {
    const db = this.getDb();

    const [logFiles, logSummaries, logHeaders, sampleSummaries] =
      await Promise.all([
        db.logs.count(),
        db.logs.where("depth").anyOf(["previewed", "detailed"]).count(),
        db.logs.where("depth").equals("detailed").count(),
        db.sample_summaries.count(),
      ]);

    return {
      logFiles,
      logSummaries,
      logHeaders,
      sampleSummaries,
      logHandle: this.manager.getDatabaseHandle(),
    };
  }
}

/**
 * Create a new database service instance.
 * Each service instance works with its own database manager.
 */
export function createDatabaseService(): DatabaseService {
  const manager = new DatabaseManager();
  return new DatabaseService(manager);
}
