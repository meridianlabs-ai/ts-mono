import type { Condition, OrderByModel } from "@tsmono/inspect-common/query";
import { ensureTrailingSlash, isInDirectory } from "@tsmono/util";

import type { Log } from "../client/api/types";
import { scopePrefix } from "../client/database";
import {
  pageRows,
  type Cursor,
  type DatabaseListingPlan,
  type DatabaseListingResult,
} from "../client/database/listing";
import { queryClient } from "../state/queryClient";
import { directoryRelativeUrl, rootName } from "../utils/uri";

import { databaseLogsListingSnapshotKey } from "./databaseListings";
import { getDatabaseService } from "./databaseServiceInstance";
import { computeLogsWithRetried, type LogListingRow } from "./logListing";
import { getLogRows, isCacheOnlyListingScope } from "./logsContent";

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
const logsListingSource = (logDir: string): "database" | "cache" =>
  getDatabaseService().opened() && !isCacheOnlyListingScope(logDir)
    ? "database"
    : "cache";

const scanRows = async (logDir: string, prefix: string): Promise<Log[]> => {
  if (logsListingSource(logDir) === "database") {
    const logs = await getDatabaseService().readLogs({ prefix });
    if (logs !== null) return logs;
    // A failed db read degrades to the cache for this query only.
  }
  // An out-of-namespace scope's names never start with the scope prefix —
  // that mismatch is what degraded it (see `namesInScope`) — so filtering
  // would drop every row. Serve the whole listing; `toRow` owns membership.
  if (isCacheOnlyListingScope(logDir)) return getLogRows(logDir);
  const scope = scopePrefix(prefix);
  return getLogRows(logDir).filter((row) => row.name.startsWith(scope));
};

/**
 * Run a listing plan over `logDir`'s rows: scan the source, mark retried
 * runs (a cross-row derivation, so it runs over the scan, before `toRow`),
 * shape each record through `toRow` (which owns row-universe membership —
 * it drops records the view has no row for), then filter and sort. Each
 * surviving row is returned beside its source record: the snapshot build
 * needs the record's key and retried mark, the row readers just the rows.
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
 *
 * `sorted: false` skips the plan's ordering, for callers that impose their
 * own (the match projection orders by snapshot key position).
 */
const scanListingEntries = async <TRow>(
  logDir: string,
  prefix: string,
  toRow: (log: LogListingRow) => TRow | undefined,
  plan: DatabaseListingPlan<TRow>,
  options?: { sorted: boolean }
): Promise<{ log: LogListingRow; row: TRow }[]> => {
  const scanned = await scanRows(logDir, prefix);
  const entries: { log: LogListingRow; row: TRow }[] = [];
  for (const log of computeLogsWithRetried(scanned)) {
    const row = toRow(log);
    if (row !== undefined && plan.matches(row)) entries.push({ log, row });
  }
  // Stable sort over the scan's listing order (mtime-descending), so ties —
  // and the unsorted listing — keep that order without a position tiebreak.
  if (plan.compare && options?.sorted !== false) {
    const compare = plan.compare;
    entries.sort((a, b) => compare(a.row, b.row));
  }
  return entries;
};

const scanListingRows = async <TRow>(
  logDir: string,
  prefix: string,
  toRow: (log: LogListingRow) => TRow | undefined,
  plan: DatabaseListingPlan<TRow>
): Promise<TRow[]> => {
  const entries = await scanListingEntries(logDir, prefix, toRow, plan);
  return entries.map((entry) => entry.row);
};

export const readLogsListing = async <TRow>(
  logDir: string,
  prefix: string,
  toRow: (log: LogListingRow) => TRow | undefined,
  plan: DatabaseListingPlan<TRow>
): Promise<DatabaseListingResult<TRow>> => {
  const rows = await scanListingRows(logDir, prefix, toRow, plan);
  const total_count = rows.length;
  return { ...pageRows(rows, plan.pagination), total_count };
};

/**
 * The tier-1 snapshot (keys-first pagination): one scan's ordered result as
 * primary keys, so the count comes free and each page is a cheap `bulkGet`
 * of a key slice — pages are mutually consistent under concurrent
 * replication writes because they all slice the same frozen ordering.
 */
export interface LogsListingSnapshot<TRow> {
  /** Ordered record keys (`file_path`) of the filtered+sorted row universe. */
  keys: string[];
  /** `keys.length` — the scan that orders also counts. */
  total_count: number;
  /** Distinct task_ids across the whole filtered universe — the scan
   *  touches every row anyway. Pages report these so the pending-task
   *  anti-join can settle a task whose file sits on an unloaded page
   *  (the loaded window alone can't prove a file exists). */
  task_ids: string[];
  /** The scan's retried marks by key. A cross-row derivation
   *  (`computeLogsWithRetried`): a page's key-slice `bulkGet` cannot
   *  re-derive it, so pages re-attach these to their records. */
  retried: Record<string, boolean>;
  /** Shaped rows for the first page, seeded by the build (decision 3): the
   *  scan shaped them anyway, so serving page one adds no second read over
   *  today's one-read flow. Sized by the build's `firstPageSize`. */
  firstPage: TRow[];
}

/** Build a {@link LogsListingSnapshot} with today's scan pipeline (the
 *  transitional form — see the retried-marking constraint in the plan doc;
 *  an index-backed walk can replace the internals later without changing
 *  the snapshot shape). */
export const readLogsListingSnapshot = async <TRow>(
  logDir: string,
  prefix: string,
  toRow: (log: LogListingRow) => TRow | undefined,
  plan: DatabaseListingPlan<TRow>,
  firstPageSize: number
): Promise<LogsListingSnapshot<TRow>> => {
  const entries = await scanListingEntries(logDir, prefix, toRow, plan);
  const keys: string[] = [];
  const retried: Record<string, boolean> = {};
  const taskIds = new Set<string>();
  for (const { log } of entries) {
    keys.push(log.name);
    if (log.retried !== undefined) retried[log.name] = log.retried;
    if (log.task_id) taskIds.add(log.task_id);
  }
  const firstPage = entries.slice(0, firstPageSize).map((entry) => entry.row);
  return {
    keys,
    total_count: keys.length,
    task_ids: [...taskIds],
    retried,
    firstPage,
  };
};

/** One page of records by key slice: `bulkGet`, re-attach the snapshot's
 *  retried marks, shape via `toRow`, re-check the plan's filter. A key
 *  deleted, reshaped out of the universe, or mutated out of the filter
 *  between snapshot and read is a dropped hole — the page runs short
 *  rather than erroring (or serving a row the active filter excludes);
 *  the next invalidation rebuilds the keys. A record mutated in its *sort*
 *  field still serves at its snapshot position — one page can't re-sort
 *  the universe. */
const readSnapshotPageRows = async <TRow>(
  snapshot: LogsListingSnapshot<TRow>,
  toRow: (log: LogListingRow) => TRow | undefined,
  plan: DatabaseListingPlan<TRow>,
  offset: number,
  limit: number
): Promise<TRow[]> => {
  const keys = snapshot.keys.slice(offset, offset + limit);
  if (keys.length === 0) return [];
  const records = await getDatabaseService().readLogRows(keys);
  const rows: TRow[] = [];
  for (const key of keys) {
    const record = records[key];
    if (record === undefined) continue;
    const row = toRow({ ...record, retried: snapshot.retried[key] });
    if (row !== undefined && plan.matches(row)) rows.push(row);
  }
  return rows;
};

/** One page of the listing plus the snapshot-scoped aggregates every page
 *  reports (like `total_count`, they come free with the snapshot scan). */
export interface LogsListingPageResult<
  TRow,
> extends DatabaseListingResult<TRow> {
  /** Distinct task_ids across the whole filtered universe (see
   *  {@link LogsListingSnapshot.task_ids}); unset on the cache path, whose
   *  single page is the whole universe. */
  universe_task_ids?: string[];
}

/** The query inputs a paged listing read composes over: the listing source
 *  (`logDir`/`prefix`/`toRow`), the snapshot's cache identity (the row
 *  query's own key slots), and the compiled plan (pagination unset — paging
 *  slices the snapshot's key list, not the plan). */
export interface LogsListingPageQuery<TRow> {
  logDir: string;
  prefix: string;
  toRow: (log: LogListingRow) => TRow | undefined;
  /** `undefined` only while the scope hydrates — queries are disabled then,
   *  so a page read never actually runs without a universe. */
  universe: string | undefined;
  accessorsKey: string;
  filter?: Condition;
  orderBy?: OrderByModel[];
  plan: DatabaseListingPlan<TRow>;
}

const fetchLogsListingSnapshot = <TRow>(
  query: LogsListingPageQuery<TRow>,
  firstPageSize: number
): Promise<LogsListingSnapshot<TRow>> =>
  queryClient.fetchQuery({
    queryKey: databaseLogsListingSnapshotKey(
      query.universe,
      query.accessorsKey,
      query.filter,
      query.orderBy
    ),
    queryFn: () =>
      readLogsListingSnapshot(
        query.logDir,
        query.prefix,
        query.toRow,
        query.plan,
        firstPageSize
      ),
    staleTime: Infinity,
    gcTime: 30_000,
  });

/**
 * Serve one page of the listing via the two-tier snapshot scheme
 * (decision 3): the snapshot is itself a react-query entry — obtained
 * through `fetchLogsListingSnapshot`, so page and Find reads dedupe into
 * one build, later reads reuse it, and lifecycle is plain `gcTime`. `fetchQuery`
 * with `staleTime: Infinity` rather than `ensureQueryData`: both dedupe,
 * but after the write path invalidates the (observer-less) snapshot,
 * `ensureQueryData` would resolve with the stale keys and only rebuild in
 * the background — a final sync write would then never reach the grid,
 * breaking the streaming invariant. `fetchQuery` awaits the rebuild
 * exactly when the snapshot has been invalidated and serves it from cache
 * otherwise.
 *
 * `limit` is required: an unlimited page would trust the cached snapshot's
 * inline first page to be the whole listing, but the snapshot key carries
 * no limit slot — one built by a limited call would be served truncated
 * with `next_cursor: null`, silently claiming completeness. Cache-only
 * scopes (db-less sessions, out-of-namespace dirs) don't take the snapshot
 * path at all — their rows already live in memory, so one scan per read
 * stays the simpler and equally-cheap form.
 */
export const readLogsListingPage = async <TRow>(
  query: LogsListingPageQuery<TRow>,
  page: { cursor?: Cursor | null; limit: number }
): Promise<LogsListingPageResult<TRow>> => {
  const { logDir, prefix, toRow, plan } = query;
  if (logsListingSource(logDir) === "cache") {
    // No universe_task_ids: the cache path's single page IS the whole
    // universe, so the anti-join's loaded-window fallback already covers it.
    return readLogsListing(logDir, prefix, toRow, plan);
  }
  // Fresh until invalidated (see above); short gcTime because the key list
  // + inline first page are per-(filter, orderBy) copies and the query has
  // no observers to keep it active.
  const snapshot = await fetchLogsListingSnapshot(query, page.limit);

  const offset =
    page.cursor && typeof page.cursor.offset === "number"
      ? page.cursor.offset
      : 0;
  const { total_count } = snapshot;
  // The inline first page covers offset 0 whenever it holds `limit` rows —
  // or the whole (shorter) universe. A cached snapshot built under another
  // limit falls through to the bulkGet path.
  const items =
    offset === 0 &&
    (snapshot.firstPage.length >= page.limit ||
      snapshot.firstPage.length === total_count)
      ? snapshot.firstPage.slice(0, page.limit)
      : await readSnapshotPageRows(snapshot, toRow, plan, offset, page.limit);
  const end = offset + page.limit;
  return {
    items,
    total_count,
    universe_task_ids: snapshot.task_ids,
    // Cursors index the snapshot's key list (not served-row counts), so a
    // dropped hole never desyncs subsequent pages.
    next_cursor: end < total_count ? { offset: end } : null,
  };
};

/** View inputs for {@link readLogsOverview}. */
export interface LogsOverviewView {
  /** Folder-mode current directory; unset in the flat tasks view (which
   *  lists the whole dir and derives no folders). */
  folderDir?: string;
  showRetriedLogs: boolean;
  /** Pre-hide row-universe membership for the view (`fileLogIdentity`
   *  presence — path logic only; the overview applies retried-hiding
   *  itself so it can also count what hiding removed). */
  isCandidate: (log: LogListingRow) => boolean;
}

/** Aggregate facts about a scope that the log-list page needs beyond the
 *  queried rows themselves. See {@link readLogsOverview}. */
export interface LogsOverview {
  /** Distinct task_ids with a log anywhere under the dir — the pending-task
   *  anti-join input. */
  taskIds: string[];
  /** File rows in the view universe (retried-hidden excluded). */
  fileCount: number;
  /** Among `fileCount`, logs still running (status "started"). */
  startedCount: number;
  /** Retried runs in the view universe pre-hiding — drives the
   *  "Show Retried Logs" toggle's visibility. */
  retriedCount: number;
  /** Set when exactly one file row exists (single-log workspace redirect). */
  soleFileName: string | undefined;
  /** Folder-mode: the current directory's immediate subdirectories. */
  folders: { name: string; itemCount: number }[];
}

/** Immediate subdirectories of `currentDir` with per-folder log counts. */
const deriveFolders = (
  rows: LogListingRow[],
  currentDir: string
): { name: string; itemCount: number }[] => {
  const dirWithSlash = ensureTrailingSlash(currentDir);

  // Count logs under a path prefix via binary search rather than a full
  // scan per folder. Names sort into contiguous ranges, so a prefix count
  // is two bound lookups.
  const sortedNames = rows.map((row) => row.name).sort();
  const lowerBound = (target: string): number => {
    let lo = 0;
    let hi = sortedNames.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const name = sortedNames[mid];
      if (name !== undefined && name < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const countWithPrefix = (prefix: string): number =>
    lowerBound(prefix + "￿") - lowerBound(prefix);

  const folders: { name: string; itemCount: number }[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const name = row.name;
    if (isInDirectory(name, currentDir) || !name.startsWith(dirWithSlash)) {
      continue;
    }
    const relativePath = directoryRelativeUrl(name, currentDir);
    // encodeURIComponent/decodeURIComponent round-trip, so this is the raw
    // first path segment under `currentDir` — the folder's own directory.
    const dirName = decodeURIComponent(rootName(relativePath));
    if (seen.has(dirName)) continue;
    seen.add(dirName);
    // Count under the folder's path, slash-terminated: an unterminated
    // prefix would also span sibling folders sharing the name as a prefix
    // (sub vs sub2), and the first-seen file's parent dir would miss logs
    // outside its own subtree when that file is nested deeper.
    folders.push({
      name: dirName,
      itemCount: countWithPrefix(dirWithSlash + dirName + "/"),
    });
  }
  return folders;
};

/**
 * One scan of `logDir`'s rows producing the page-level aggregates: pending
 * anti-join input, progress/footer counts, retried presence, the sole-file
 * redirect target, and folder summaries. These are the derivations that
 * would otherwise force the full row list into memory beside the row query;
 * keeping them behind one read means pagination only changes this module.
 * Like `readLogsListing`, deliberately not gated on sync state.
 */
export const readLogsOverview = async (
  logDir: string,
  view: LogsOverviewView
): Promise<LogsOverview> => {
  const scanned = await scanRows(logDir, logDir);
  const rows = computeLogsWithRetried(scanned);

  const taskIds = new Set<string>();
  let fileCount = 0;
  let startedCount = 0;
  let retriedCount = 0;
  let soleFileName: string | undefined;
  for (const log of rows) {
    if (log.task_id) taskIds.add(log.task_id);
    if (!view.isCandidate(log)) continue;
    if (log.retried) {
      retriedCount += 1;
      if (!view.showRetriedLogs) continue;
    }
    fileCount += 1;
    soleFileName = fileCount === 1 ? log.name : undefined;
    if (log.status === "started") startedCount += 1;
  }

  return {
    taskIds: [...taskIds],
    fileCount,
    startedCount,
    retriedCount,
    soleFileName,
    folders:
      view.folderDir === undefined ? [] : deriveFolders(rows, view.folderDir),
  };
};

export interface LogsListingMatch {
  id: string;
  /** Zero-based position in the filtered + sorted snapshot key list. */
  offset: number;
  /** Values needed to merge transient matching rows into file-match order. */
  orderValues?: Record<string, unknown>;
}

/** Rows whose searchable text contains `term` (case-insensitive), in the
 * same snapshot order and with the same offsets as page cursors. */
export const readLogsListingMatches = async <TRow>(
  query: LogsListingPageQuery<TRow>,
  find: {
    pageSize: number;
    term: string;
    getRowId: (row: TRow) => string;
    getOrderValue: (row: TRow, columnId: string) => unknown;
    /** A row's searchable text, already lowercased (`rowSearchText`'s
     *  contract) — the scan must not pay a second per-row lowering. */
    rowText: (row: TRow) => string;
  }
): Promise<LogsListingMatch[]> => {
  const { logDir, prefix, toRow, plan } = query;
  const term = find.term.toLowerCase();
  const toMatch = (row: TRow, offset: number): LogsListingMatch => {
    const orderValues = query.orderBy?.length
      ? Object.fromEntries(
          query.orderBy.map(({ column }) => [
            column,
            find.getOrderValue(row, column),
          ])
        )
      : undefined;
    const match = { id: find.getRowId(row), offset };
    return orderValues === undefined ? match : { ...match, orderValues };
  };

  if (logsListingSource(logDir) === "cache") {
    const rows = await scanListingRows(logDir, prefix, toRow, plan);
    const matches: LogsListingMatch[] = [];
    for (let offset = 0; offset < rows.length; offset++) {
      const row = rows[offset]!;
      if (find.rowText(row).includes(term)) {
        matches.push(toMatch(row, offset));
      }
    }
    return matches;
  }

  // The match scan doesn't consume the snapshot until the join below, so
  // overlap the two store reads: on a stale snapshot (first keystroke per
  // (filter, orderBy), post-invalidation refetch) each is a full table
  // scan, and serializing them doubles per-keystroke match latency.
  // Unsorted scan: order comes from the snapshot's key positions below, so
  // the plan's full-list sort would be paid per keystroke and discarded.
  const [snapshot, entries] = await Promise.all([
    fetchLogsListingSnapshot(query, find.pageSize),
    scanListingEntries(logDir, prefix, toRow, plan, { sorted: false }),
  ]);
  const offsetByKey = new Map(
    snapshot.keys.map((key, offset) => [key, offset] as const)
  );
  const matches: LogsListingMatch[] = [];
  for (const { log, row } of entries) {
    const offset = offsetByKey.get(log.name);
    if (offset !== undefined && find.rowText(row).includes(term)) {
      matches.push(toMatch(row, offset));
    }
  }
  matches.sort((a, b) => a.offset - b.offset);
  return matches;
};
