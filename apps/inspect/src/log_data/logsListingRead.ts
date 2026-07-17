import type { Log } from "../client/api/types";
import { scopePrefix } from "../client/database";
import {
  pageRows,
  type DatabaseListingPlan,
  type DatabaseListingResult,
} from "../client/database/listing";

import { getDatabaseService } from "./databaseServiceInstance";
import { computeLogsWithRetried, type LogListingRow } from "./logListing";
import { getLogRows, isCacheOnlyListingScope } from "./logsContent";

export type LogsListingSource = "database" | "cache";

/**
 * Where listing queries for `logDir` read their rows — an explicit,
 * scope-level decision rather than a per-query fallback:
 *
 * - "database": the normal dir-mode path; IndexedDB holds the replicated
 *   rows and is the row source.
 * - "cache": the react-query logs cache is the row source. This serves the
 *   out-of-namespace degrade (listing persistence skipped — see
 *   `namesInScope` in logsContent) and db-less sessions (the database
 *   failed to open; single-file mode renders no log list at all).
 */
export const logsListingSource = (logDir: string): LogsListingSource =>
  getDatabaseService().opened() && !isCacheOnlyListingScope(logDir)
    ? "database"
    : "cache";

const scanRows = async (logDir: string, prefix: string): Promise<Log[]> => {
  if (logsListingSource(logDir) === "database") {
    const logs = await getDatabaseService().readLogs({ prefix });
    if (logs !== null) return logs;
    // A failed db read degrades to the cache for this query only.
  }
  const scope = scopePrefix(prefix);
  return getLogRows(logDir).filter((row) => row.name.startsWith(scope));
};

/**
 * Run a listing plan over `logDir`'s rows: scan the source, mark retried
 * runs (a cross-row derivation, so it runs over the scan, before `toRow`),
 * shape each record through `toRow` (which owns row-universe membership —
 * it drops records the view has no row for), then filter, sort, paginate.
 *
 * Deliberately NOT gated on the scope's sync state: results reflect
 * whatever has replicated so far — a warm cache from a prior session, or a
 * partially-landed sync — and the write path's invalidation refreshes
 * observers as further writes land. Callers surface sync progress
 * separately rather than hiding rows behind it.
 *
 * `prefix` narrows the scan (folder mode lists a subdirectory). Retried
 * grouping keys on a row's exact parent directory, so a boundary-safe
 * prefix scan never splits a group and the marking matches a whole-dir
 * scan's.
 */
export const readLogsListing = async <TRow>(
  logDir: string,
  prefix: string,
  toRow: (log: LogListingRow) => TRow | undefined,
  plan: DatabaseListingPlan<TRow>
): Promise<DatabaseListingResult<TRow>> => {
  const scanned = await scanRows(logDir, prefix);
  const rows: TRow[] = [];
  for (const log of computeLogsWithRetried(scanned)) {
    const row = toRow(log);
    if (row !== undefined && plan.matches(row)) rows.push(row);
  }
  // Stable sort over the scan's listing order (mtime-descending), so ties —
  // and the unsorted listing — keep that order without a position tiebreak.
  if (plan.compare) rows.sort(plan.compare);
  const total_count = rows.length;
  return { ...pageRows(rows, plan.pagination), total_count };
};
