import Dexie from "dexie";

import { Log, SampleSummary } from "../api/types";

// Logs Table — THE Log entity row: identity + attribute columns at
// progressive depth + retrieval facts (see
// design/migration/log-data-summaries-entity.md, phase 3). `id` preserves
// insertion order for listings without mtimes.
export interface LogRecord extends Omit<Log, "name"> {
  // Auto-incrementing primary key for insertion order
  id?: number;
  file_path: string;
  cached_at: string;
}

export const toLogRecord = (
  log: Log,
  id: number | undefined,
  cached_at: string
): LogRecord => {
  const { name, ...rest } = log;
  return { ...rest, id, file_path: name, cached_at };
};

export const fromLogRecord = (record: LogRecord): Log => {
  const { id: _id, file_path, cached_at: _cached, ...rest } = record;
  return { ...rest, name: file_path };
};

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

// Current database schema version
export const DB_VERSION = 12;

// Resolves a log dir into a database name
function resolveDBName(databaseHandle: string): string {
  const sanitizedDir = databaseHandle.replace(/[^a-zA-Z0-9_-]/g, "_");
  const dbName = `InspectAI_${sanitizedDir}`;
  return dbName;
}

export class AppDatabase extends Dexie {
  logs!: Dexie.Table<LogRecord, number>;
  sample_summaries!: Dexie.Table<
    SampleSummaryRecord,
    [string, string | number, number]
  >;

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
        // The Log entity rows. depth is indexed for backfill discovery
        // (missing previews/details); mtime for listing order.
        logs: "++id, &file_path, mtime, task, task_id, depth, cached_at",

        // Sample summaries split out of details payloads. file_path serves
        // scope reads (equals / startsWith); summary.completed_at serves the
        // default listing sort.
        sample_summaries:
          "[file_path+id+epoch], file_path, summary.completed_at",

        // Superseded pre-v12 stores (their content lives on the logs row).
        log_previews: null,
        log_details: null,
        log_fetch_state: null,
      })
      // Recreate-on-mismatch is the policy (this is a cache; rows written
      // under an older schema may not match current record shapes). The
      // delete path in checkVersionMismatch can be missed (it swallows
      // errors, e.g. a probe blocked by another tab's open connection), and
      // Dexie then upgrades the old file IN PLACE, keeping stale rows — so
      // the upgrade itself wipes every surviving table too.
      .upgrade((tx) =>
        Promise.all(
          ["logs", "sample_summaries"].map((table) => tx.table(table).clear())
        )
      );
  }
}
