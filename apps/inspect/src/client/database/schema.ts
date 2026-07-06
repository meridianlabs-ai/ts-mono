import Dexie from "dexie";

import { LogHeader, LogPreview, SampleSummary } from "../api/types";

// Logs Table - Basic file listing
export interface LogHandleRecord {
  // Auto-incrementing primary key for insertion order
  id?: number;
  file_path: string;
  file_name: string;
  task?: string | null;
  task_id?: string | null;
  mtime?: number | null;
  cached_at: string;
}

// Log Previews Table - Stores results from get_log_summaries()
export interface LogPreviewRecord {
  // Primary key
  file_path: string;

  // The complete log summary object
  preview: LogPreview;

  cached_at: string;
}

// Log Details Table - one log's header (details payload minus sample
// summaries, plus ingestion-derived sample facts). The summaries themselves
// live in sample_summaries.
export interface LogDetailsRecord {
  // Primary key
  file_path: string;

  details: LogHeader;

  cached_at: string;
}

// Sample Summaries Table - one row per sample summary, split out of the
// details payload at ingestion.
export interface SampleSummaryRecord {
  // [file_path+id+epoch] is the primary key
  file_path: string;
  id: string | number;
  epoch: number;

  summary: SampleSummary;

  cached_at: string;
}

// Log Fetch State Table - Per-handle retrieval (fetch) error/attempt tracking.
// This is a SEPARATE domain from eval status/error (those live inside
// LogPreview/LogDetails) — an absent row means no known retrieval problem.
export interface LogFetchStateRecord {
  // Primary key
  file_path: string;

  preview_fetch_error?: string;
  preview_attempts: number;
  details_fetch_error?: string;
  details_attempts: number;
  /** Session-local settle counter for waitered (user) details fetches;
   *  cache-only in practice, harmless if persisted. */
  details_settled_seq: number;
  updated_at: string;
}

// Current database schema version
export const DB_VERSION = 11;

// Resolves a log dir into a database name
function resolveDBName(databaseHandle: string): string {
  const sanitizedDir = databaseHandle.replace(/[^a-zA-Z0-9_-]/g, "_");
  const dbName = `InspectAI_${sanitizedDir}`;
  return dbName;
}

export class AppDatabase extends Dexie {
  logs!: Dexie.Table<LogHandleRecord, number>;
  log_previews!: Dexie.Table<LogPreviewRecord, string>;
  log_details!: Dexie.Table<LogDetailsRecord, string>;
  sample_summaries!: Dexie.Table<
    SampleSummaryRecord,
    [string, string | number, number]
  >;
  log_fetch_state!: Dexie.Table<LogFetchStateRecord, string>;

  /**
   * Check if an existing database needs to be recreated due to version mismatch.
   * Returns true if the database should be deleted and recreated.
   */
  static async checkVersionMismatch(databaseHandle: string): Promise<boolean> {
    const dbName = resolveDBName(databaseHandle);

    try {
      // Check if database exists and get its version
      const existingDb = await Dexie.exists(dbName);
      if (!existingDb) {
        return false;
      }

      // Open with minimal schema to check actual version
      const tempDb = new Dexie(dbName);
      await tempDb.open();
      const currentVersion = tempDb.verno; // Dexie's internal version number
      tempDb.close();

      if (currentVersion !== DB_VERSION) {
        console.log(
          `Database version mismatch (found v${currentVersion}, expected v${DB_VERSION})`
        );
        return true;
      }
      return false;
    } catch {
      // Database doesn't exist or has issues - let normal flow handle it
      return false;
    }
  }

  constructor(databaseHandle: string) {
    super(resolveDBName(databaseHandle));

    this.version(DB_VERSION)
      .stores({
        // Basic file listing - indexes for querying and sorting
        logs: "++id, &file_path, mtime, task, task_id, cached_at",

        // Log summaries from get_log_summaries() - indexes for common queries
        log_previews:
          "file_path, preview.status, preview.task_id, preview.model, cached_at",

        // Log headers (details minus summaries + derived sample facts)
        log_details: "file_path, details.status, cached_at",

        // Sample summaries split out of details payloads. file_path serves
        // scope reads (equals / startsWith); summary.completed_at serves the
        // default listing sort.
        sample_summaries:
          "[file_path+id+epoch], file_path, summary.completed_at",

        // Per-handle retrieval error/attempt tracking
        log_fetch_state: "file_path",
      })
      // Recreate-on-mismatch is the policy (this is a cache; rows written
      // under an older schema may not match current record shapes). The
      // delete path in checkVersionMismatch can be missed (it swallows
      // errors, e.g. a probe blocked by another tab's open connection), and
      // Dexie then upgrades the old file IN PLACE, keeping stale rows — so
      // the upgrade itself wipes every table too.
      .upgrade((tx) =>
        Promise.all(
          [
            "logs",
            "log_previews",
            "log_details",
            "sample_summaries",
            "log_fetch_state",
          ].map((table) => tx.table(table).clear())
        )
      );
  }
}
