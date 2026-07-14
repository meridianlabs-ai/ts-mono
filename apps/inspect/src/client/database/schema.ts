import Dexie from "dexie";

import { Log, SampleDerived, SampleSummary } from "../api/types";

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
  derived: SampleDerived;

  cached_at: string;
}

// Sync Scopes Table - one row per log-dir prefix that has been replicated
// into the (unified) database. Rows under a prefix are only reconciled/pruned
// by that scope's listing syncs; the timestamps exist so future
// eviction/cleanup policies can reason about scope staleness.
export interface SyncScopeRecord {
  /** The scope's directory prefix (a `file_path` prefix), stored in
   *  boundary-safe `scopePrefix` form so `clearScope` can sweep a scope and
   *  everything nested under it with one prefix match. */
  prefix: string;
  /** Last time a listing sync persisted under this scope. */
  last_synced?: string;
  /** Last time the app activated this scope. */
  last_accessed: string;
}

// Current database schema version. Bump on any schema change AND on any
// behavior change in `deriveLogFields`/`deriveSampleFields` — stored rows
// carry derived values and are only recomputed via the recreate-on-mismatch
// wipe.
export const DB_VERSION = 15;

// One database per origin (not per log dir): `file_path` is a full path/URI,
// so rows from overlapping dirs (e.g. /logs and /logs/important) share
// identity and replicate once. "Current log dir" is a query scope, not a
// storage boundary. Pre-unification databases were named
// `InspectAI_<sanitized dir>` — see `deleteLegacyDatabases`.
export const DB_NAME = "InspectAI";

/** The boundary-safe prefix for scoping `file_path` queries to a dir:
 *  `/logs/important` must not match `/logs/important-2`. */
export const scopePrefix = (dir: string): string =>
  dir.endsWith("/") ? dir : `${dir}/`;

export class AppDatabase extends Dexie {
  logs!: Dexie.Table<LogRecord, number>;
  sample_summaries!: Dexie.Table<
    SampleSummaryRecord,
    [string, string | number, number]
  >;
  sync_scopes!: Dexie.Table<SyncScopeRecord, string>;

  /**
   * Check if an existing database needs to be recreated due to version mismatch.
   * Returns true if the database should be deleted and recreated.
   */
  static async checkVersionMismatch(): Promise<boolean> {
    const dbName = DB_NAME;

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

  constructor() {
    super(DB_NAME);

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

        // Replicated log-dir scopes (see SyncScopeRecord).
        sync_scopes: "prefix",

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
          ["logs", "sample_summaries", "sync_scopes"].map((table) =>
            tx.table(table).clear()
          )
        )
      );
  }
}

/**
 * Delete pre-unification per-dir databases (`InspectAI_<sanitized dir>`).
 * Best-effort: `indexedDB.databases()` is not universally available and a
 * database held open by another (older) tab may survive until it closes.
 */
export const deleteLegacyDatabases = async (): Promise<void> => {
  try {
    const databases = await indexedDB.databases();
    await Promise.all(
      databases
        .map((info) => info.name)
        .filter((name): name is string => !!name?.startsWith(`${DB_NAME}_`))
        .map((name) => Dexie.delete(name).catch(() => {}))
    );
  } catch {
    // Enumeration unavailable or failed — legacy databases linger, harmless.
  }
};
