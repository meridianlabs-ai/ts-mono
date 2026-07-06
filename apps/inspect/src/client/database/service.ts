import { LogHandle } from "@tsmono/inspect-common";
import { createLogger } from "@tsmono/util";

import { LogDetails, LogHeader, LogPreview } from "../api/types";
import { toLogHeader } from "../utils/type-utils";

import { DatabaseManager } from "./manager";
import {
  AppDatabase,
  LogFetchStateRecord,
  LogHandleRecord,
  SampleSummaryRecord,
} from "./schema";

/** Scope of a sample-summaries read: one log file, or every file under a
 *  path prefix. */
export type SampleSummariesScope = { file: string } | { prefix: string };

const log = createLogger("DatabaseService");

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

  async countRows(
    entity: "logs" | "logPreviews" | "logDetails"
  ): Promise<number> {
    const db = this.getDb();
    switch (entity) {
      case "logs":
        return db.logs.count();
      case "logPreviews":
        return db.log_previews.count();
      case "logDetails":
        return db.log_details.count();
    }
  }

  // === LOG FILES ===
  async writeLogs(logs: LogHandle[]): Promise<void> {
    const db = this.getDb();
    const now = new Date().toISOString();

    // Get existing records to preserve their IDs
    const existingRecords = await db.logs.toArray();
    const existingByPath = new Map(
      existingRecords.map((r) => [r.file_path, r.id])
    );

    const records = logs.map<LogHandleRecord>((file) => ({
      id: existingByPath.get(file.name),
      file_path: file.name,
      file_name: file.name.split("/").pop() || file.name,
      task: file.task,
      task_id: file.task_id,
      mtime: file.mtime,
      cached_at: now,
    }));

    log.debug(`Caching ${records.length} log files`);
    await db.logs.bulkPut(records);
  }

  async readLogs(): Promise<LogHandle[] | null> {
    try {
      if (!this.opened()) {
        log.debug("Database not open");
        return null;
      }

      const db = this.getDb();
      // Sort by mtime if available, otherwise by id (insertion order)
      const files = await db.logs.toArray();

      // Sort by mtime (descending) if present, otherwise maintain insertion order.
      // Note: != null (not !==) catches both null and undefined.
      files.sort((a, b) => {
        if (a.mtime != null && b.mtime != null) return b.mtime - a.mtime;
        if (a.id != null && b.id != null) return a.id - b.id;
        return 0;
      });

      if (files.length === 0) {
        log.debug("No cached log files found");
        return [];
      }

      log.debug(`Retrieved ${files.length} cached log files`);
      return files.map((file) => ({
        name: file.file_path,
        task: file.task,
        task_id: file.task_id,
        mtime: file.mtime,
      }));
    } catch (error) {
      log.error("Error retrieving cached log files:", error);
      return null;
    }
  }

  // === LOG PREVIEWS ===
  async writeLogPreviews(
    previews: LogPreview[],
    filePaths: string[]
  ): Promise<void> {
    const db = this.getDb();
    const now = new Date().toISOString();

    const records = previews.map((summary, index) => ({
      file_path: filePaths[index],
      cached_at: now,
      preview: summary,
    }));

    log.debug(`Caching ${records.length} log previews`);
    // @ts-expect-error pre-existing noUncheckedIndexedAccess violation (TODO: narrow when touched)
    await db.log_previews.bulkPut(records);
  }

  async readLogPreviews(
    logs: LogHandle[]
  ): Promise<Record<string, LogPreview>> {
    try {
      const filePaths = logs.map((log) => log.name);
      const db = this.getDb();
      const records = await db.log_previews
        .where("file_path")
        .anyOf(filePaths)
        .toArray();

      log.debug(
        `Retrieved ${records.length} cached log previews out of ${filePaths.length} requested`
      );

      const result: Record<string, LogPreview> = {};
      for (const record of records) {
        result[record.file_path] = record.preview;
      }

      return result;
    } catch (error) {
      log.error("Error retrieving cached log summaries:", error);
      return {};
    }
  }

  async findMissingPreviews(logs: LogHandle[]): Promise<LogHandle[]> {
    try {
      const filePaths = logs.map((log) => log.name);
      const db = this.getDb();
      const records = await db.log_previews
        .where("file_path")
        .anyOf(filePaths)
        .toArray();

      const cachedPaths = new Set(records.map((r) => r.file_path));
      const missing = logs.filter((log) => !cachedPaths.has(log.name));

      log.debug(
        `Found ${missing.length} missing previews out of ${logs.length} requested`
      );
      return missing;
    } catch (error) {
      log.error("Error finding missing previews:", error);
      return logs;
    }
  }

  // === LOG DETAILS ===

  /**
   * Ingest details payloads: split each into a header row and its sample
   * summary rows, written in one transaction per call so a reader never sees
   * a header whose summary rows are from an older ingestion. Old summary
   * rows for each file are dropped first — re-ingestion replaces, never
   * accretes.
   */
  async writeLogDetails(details: Record<string, LogDetails>): Promise<void> {
    const db = this.getDb();
    const now = new Date().toISOString();

    const entries = Object.entries(details);
    log.debug(`Caching ${entries.length} log details (split)`);
    await db.transaction("rw", db.log_details, db.sample_summaries, async () => {
      await db.log_details.bulkPut(
        entries.map(([filePath, payload]) => ({
          file_path: filePath,
          cached_at: now,
          details: toLogHeader(payload),
        }))
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

  async readLogDetailsForFile(filePath: string): Promise<LogHeader | null> {
    try {
      const db = this.getDb();
      const record = await db.log_details.get(filePath);

      if (!record) {
        log.debug(`No cached log info found for: ${filePath}`);
        return null;
      }

      log.debug(`Retrieved cached log info for: ${filePath}`);
      return record.details;
    } catch (error) {
      log.error(`Error retrieving cached log info for ${filePath}:`, error);
      return null;
    }
  }

  async readLogDetails(logs: LogHandle[]): Promise<Record<string, LogHeader>> {
    return this.readLogHeaders(logs.map((log) => log.name));
  }

  async readLogHeaders(
    filePaths: string[]
  ): Promise<Record<string, LogHeader>> {
    try {
      const db = this.getDb();
      const records = await db.log_details
        .where("file_path")
        .anyOf(filePaths)
        .toArray();

      log.debug(
        `Retrieved ${records.length} cached log headers out of ${filePaths.length} requested`
      );

      const result: Record<string, LogHeader> = {};
      for (const record of records) {
        result[record.file_path] = record.details;
      }

      return result;
    } catch (error) {
      log.error("Error retrieving cached log headers:", error);
      return {};
    }
  }

  async findMissingDetails(logs: LogHandle[]): Promise<LogHandle[]> {
    try {
      const filePaths = logs.map((log) => log.name);
      const db = this.getDb();
      const records = await db.log_details
        .where("file_path")
        .anyOf(filePaths)
        .toArray();

      // A "started" details row is a mid-run snapshot — the run may have
      // finished since, so it doesn't count as cached.
      const cachedPaths = new Set(
        records
          .filter((r) => r.details.status !== "started")
          .map((r) => r.file_path)
      );
      const missing = logs.filter((log) => !cachedPaths.has(log.name));

      log.debug(
        `Found ${missing.length} missing details out of ${logs.length} requested`
      );
      return missing;
    } catch (error) {
      log.error("Error finding missing details:", error);
      return logs;
    }
  }

  // === LOG FETCH STATE ===
  async writeFetchStates(
    states: Record<string, LogFetchStateRecord>
  ): Promise<void> {
    const db = this.getDb();
    log.debug(`Caching ${Object.keys(states).length} fetch-state records`);
    await db.log_fetch_state.bulkPut(Object.values(states));
  }

  async readFetchStates(): Promise<Record<string, LogFetchStateRecord>> {
    try {
      const db = this.getDb();
      const records = await db.log_fetch_state.toArray();

      const result: Record<string, LogFetchStateRecord> = {};
      for (const record of records) {
        result[record.file_path] = record;
      }
      return result;
    } catch (error) {
      log.error("Error retrieving fetch-state records:", error);
      return {};
    }
  }

  // === MANAGEMENT ===

  /**
   * Clear all cached data from all tables.
   */
  async clearAllCaches(): Promise<void> {
    const db = this.getDb();

    log.debug("Clearing all caches");
    await Promise.all([
      db.logs.clear(),
      db.log_previews.clear(),
      db.log_details.clear(),
      db.sample_summaries.clear(),
      db.log_fetch_state.clear(),
    ]);
  }

  /**
   * Clear cache for a specific log file
   */
  async clearCacheForFile(filePath: string): Promise<void> {
    const db = this.getDb();
    log.debug(`Clearing cache for file: ${filePath}`);

    await Promise.all([
      db.logs.where("file_path").equals(filePath).delete(),
      db.log_previews.where("file_path").equals(filePath).delete(),
      db.log_details.where("file_path").equals(filePath).delete(),
      db.sample_summaries.where("file_path").equals(filePath).delete(),
      db.log_fetch_state.where("file_path").equals(filePath).delete(),
    ]);
  }

  async clearPreviewForFile(filePath: string): Promise<void> {
    const db = this.getDb();
    await db.log_previews.where("file_path").equals(filePath).delete();
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

    const [logFiles, logSummaries, logInfo, sampleSummaries] =
      await Promise.all([
        db.logs.count(),
        db.log_previews.count(),
        db.log_details.count(),
        db.sample_summaries.count(),
      ]);

    return {
      logFiles,
      logSummaries,
      logHeaders: logInfo, // For backward compatibility
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
