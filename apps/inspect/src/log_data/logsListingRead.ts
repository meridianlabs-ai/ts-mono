import type {
  Condition,
  OrderByModel,
  Pagination,
} from "@tsmono/inspect-common/query";
import { ensureTrailingSlash, isInDirectory } from "@tsmono/util";

import type { Log } from "../client/api/types";
import { scopePrefix } from "../client/database";
import type {
  Cursor,
  DatabaseListingPlan,
  DatabaseListingResult,
} from "../client/database/listing";
import { directoryRelativeUrl, rootName } from "../utils/uri";

import { getDatabaseService } from "./databaseServiceInstance";
import {
  parentDirCondition,
  type LogColumnSchema,
} from "./listing/logColumnSchema";
import { createListingPlan } from "./listing/planner";
import { joinSearchText } from "./listing/searchText";
import { computeLogsWithRetried, type LogListingRow } from "./logListing";
import {
  getLogRows,
  isCacheOnlyListingScope,
  logsListingSource,
} from "./logsContent";
import { logsListingEpoch } from "./logsListingEpoch";
import { computeScorerMap, type ScorerMap } from "./scoreSchema";

/** Where a listing read scans (derived from the filter — see
 *  {@link scanScopeFromFilter}): the db path uses `parentDir` (a
 *  `parent_dir` index equality — exactly the direct children) when set,
 *  else a boundary-safe `prefix` range; the cache path always
 *  prefix-filters (a superset — the plan's conditions finish the job). */
interface ScanScope {
  prefix: string;
  parentDir?: string;
}

const scanRows = async (logDir: string, scope: ScanScope): Promise<Log[]> => {
  if (logsListingSource(logDir) === "database") {
    const logs = await getDatabaseService().readLogs(
      scope.parentDir !== undefined
        ? { parentDir: scope.parentDir }
        : { prefix: scope.prefix }
    );
    if (logs !== null) return logs;
    // `readLogs` swallows store errors to null. Don't degrade to the cache
    // mirror: it can be GC'd empty, and the snapshot cache would then serve
    // "no items" as a durable success over a populated database —
    // indistinguishable from mass deletion (the same rationale as
    // readLogRows' no-catch). Reject so the listing query settles in error
    // and the retry/banner path owns recovery.
    throw new Error("Reading the log listing from the local database failed");
  }
  // An out-of-namespace scope's names never start with the scope prefix —
  // that mismatch is what degraded it (see `namesInScope`) — so filtering
  // would drop every row. Serve the whole listing; the filter conditions
  // own membership.
  if (isCacheOnlyListingScope(logDir)) return getLogRows(logDir);
  const prefix = scopePrefix(scope.prefix);
  return getLogRows(logDir).filter((row) => row.name.startsWith(prefix));
};

/**
 * Narrow a scan when the filter pins `parent_dir`: only AND branches are
 * walked (an equality under OR/NOT can't narrow the scan). The pinned
 * directory serves as an index equality on the db path — exactly the
 * direct children the condition admits — and as a subtree prefix on the
 * cache path (a superset; the condition itself finishes the filtering).
 * One representation, with the scope derived rather than passed alongside
 * (the two can't drift). Retried grouping keys on a row's exact parent
 * directory, so both scan shapes keep every group whole.
 */
const scanScopeFromFilter = (logDir: string, filter?: Condition): ScanScope => {
  const walk = (condition: Condition): string | undefined => {
    if (condition.compound) {
      if (condition.operator !== "AND") return undefined;
      return (
        walk(condition.left) ??
        (condition.right ? walk(condition.right) : undefined)
      );
    }
    return condition.operator === "=" &&
      condition.left === "parent_dir" &&
      typeof condition.right === "string"
      ? condition.right
      : undefined;
  };
  const parentDir = filter && walk(filter);
  return parentDir === undefined
    ? { prefix: logDir }
    : { prefix: parentDir, parentDir };
};

/**
 * Run a listing plan over `logDir`'s records: scan the source, mark
 * retried runs (a cross-row derivation, so it runs over the scan first),
 * then filter and sort. Membership and user filters alike are conditions
 * evaluated through the column schema — no view code in the path.
 *
 * Deliberately NOT gated on the scope's sync state: results reflect
 * whatever has replicated so far — a warm cache from a prior session, or a
 * partially-landed sync — and the write path's invalidation refreshes
 * observers as further writes land. Callers surface sync progress
 * separately rather than hiding rows behind it.
 *
 * `scope` narrows the scan (derived from the filter — see
 * {@link scanScopeFromFilter}).
 *
 * `sorted: false` skips the plan's ordering, for callers that impose their
 * own (the match projection orders by snapshot key position).
 */
const scanListingRecords = async (
  logDir: string,
  scope: ScanScope,
  plan: DatabaseListingPlan<LogListingRow>,
  options?: { sorted: boolean }
): Promise<LogListingRow[]> => {
  const scanned = await scanRows(logDir, scope);
  const records = computeLogsWithRetried(scanned).filter(plan.matches);
  // Stable sort over the scan's listing order (mtime-descending), so ties —
  // and the unsorted listing — keep that order without a position tiebreak.
  if (plan.compare && options?.sorted !== false) {
    records.sort(plan.compare);
  }
  return records;
};

/** Resolve a pagination request against a result of `total` rows: the
 *  half-open [start, end) slice plus its continuation cursor. Cursors are
 *  offsets into the filtered+sorted result (not served-row counts, so a
 *  dropped hole never desyncs subsequent pages); a backward page is the
 *  slice before the cursor, and a null backward cursor starts from the
 *  end. One encoding for both row sources — the db and cache paths must
 *  agree so a cursor stays meaningful if the source flips mid-session. */
const pageBounds = (
  total: number,
  pagination: Pagination
): { start: number; end: number; next_cursor: Cursor | null } => {
  const cursorOffset =
    pagination.cursor && typeof pagination.cursor.offset === "number"
      ? pagination.cursor.offset
      : undefined;
  const backward = pagination.direction === "backward";
  const start = backward
    ? Math.max(0, (cursorOffset ?? total) - pagination.limit)
    : (cursorOffset ?? 0);
  const end = backward ? (cursorOffset ?? total) : start + pagination.limit;
  return {
    start,
    end,
    next_cursor: backward
      ? start > 0
        ? { offset: start }
        : null
      : end < total
        ? { offset: end }
        : null,
  };
};

/**
 * The tier-1 snapshot (keys-first pagination): one scan's ordered result as
 * primary keys, so the count comes free and each page is a cheap `bulkGet`
 * of a key slice — pages are mutually consistent under concurrent
 * replication writes because they all slice the same frozen ordering.
 */
export interface LogsListingSnapshot {
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
  /** Records for the first page, seeded by the build: the scan held them
   *  anyway, so serving page one adds no second read over the one-read
   *  flow. Sized by the build's `firstPageSize`. */
  firstPage: LogListingRow[];
}

/** Build a {@link LogsListingSnapshot} with today's scan pipeline (the
 *  transitional form — see the retried-marking constraint in the plan doc;
 *  an index-backed walk can replace the internals later without changing
 *  the snapshot shape). */
export const readLogsListingSnapshot = async (
  logDir: string,
  scope: ScanScope,
  plan: DatabaseListingPlan<LogListingRow>,
  firstPageSize: number
): Promise<LogsListingSnapshot> => {
  const records = await scanListingRecords(logDir, scope, plan);
  const keys: string[] = [];
  const retried: Record<string, boolean> = {};
  const taskIds = new Set<string>();
  for (const log of records) {
    keys.push(log.name);
    retried[log.name] = log.retried ?? false;
    if (log.task_id) taskIds.add(log.task_id);
  }
  return {
    keys,
    total_count: keys.length,
    task_ids: [...taskIds],
    retried,
    firstPage: records.slice(0, firstPageSize),
  };
};

/** One page of records by key slice: `bulkGet`, re-attach the snapshot's
 *  retried marks, re-check the plan's filter. A key deleted or mutated out
 *  of the filter between snapshot and read is a dropped hole — the page
 *  runs short rather than erroring (or serving a row the active filter
 *  excludes); the next invalidation rebuilds the keys. A record mutated in
 *  its *sort* field still serves at its snapshot position — one page can't
 *  re-sort the universe. */
const readSnapshotPageRows = async (
  snapshot: LogsListingSnapshot,
  plan: DatabaseListingPlan<LogListingRow>,
  offset: number,
  limit: number
): Promise<LogListingRow[]> => {
  const keys = snapshot.keys.slice(offset, offset + limit);
  if (keys.length === 0) return [];
  const records = await getDatabaseService().readLogRows(keys);
  const rows: LogListingRow[] = [];
  for (const key of keys) {
    const record = records[key];
    if (record === undefined) continue;
    const log = { ...record, retried: snapshot.retried[key] };
    if (plan.matches(log)) rows.push(log);
  }
  return rows;
};

/** One page of the listing plus the snapshot-scoped aggregates every page
 *  reports (like `total_count`, they come free with the snapshot scan). */
export interface LogsListingPageResult<
  TRow,
> extends DatabaseListingResult<TRow> {
  /** Distinct task_ids across the whole filtered universe (see
   *  {@link LogsListingSnapshot.task_ids}) — both row sources report it, so
   *  the pending anti-join can settle tasks whose files sit on unloaded
   *  pages. */
  universe_task_ids?: string[];
}

/** Options for {@link readLogsOverview}. Named options rather than
 *  conditions because the overview deliberately reports across several
 *  membership variants in one scan (`retriedCount` counts exactly what
 *  retried-hiding removes; `taskIds` spans the whole dir regardless). */
export interface LogsOverviewOptions {
  /** Folder-mode current directory: file facts count its direct children
   *  (the listing's `parent_dir` membership) and its immediate
   *  subdirectories are derived. Unset in the flat tasks view, which lists
   *  the whole dir and derives no folders. */
  folderDir?: string;
  /** Whether the listing shows retried runs — mirrors the listing's
   *  retried-hiding in the counts. */
  showRetriedLogs: boolean;
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
 * Like the listing reads, deliberately not gated on sync state.
 */
export const readLogsOverview = async (
  logDir: string,
  schema: LogColumnSchema,
  options: LogsOverviewOptions
): Promise<LogsOverview> => {
  const scanned = await scanRows(logDir, { prefix: logDir });
  const rows = computeLogsWithRetried(scanned);

  // Directory membership exactly as the listing evaluates it — the same
  // `parent_dir` condition through the same schema — so file facts count
  // the universe the grid renders rather than a second, hand-maintained
  // reading of it (the tasks view lists the whole dir).
  const isCandidate =
    options.folderDir === undefined
      ? () => true
      : createListingPlan({
          filter: parentDirCondition(options.folderDir),
          getValue: schema.getValue,
          getComparator: schema.getComparator,
          getFilterType: schema.getFilterType,
        }).matches;

  const taskIds = new Set<string>();
  let fileCount = 0;
  let startedCount = 0;
  let retriedCount = 0;
  let soleFileName: string | undefined;
  for (const log of rows) {
    if (log.task_id) taskIds.add(log.task_id);
    if (!isCandidate(log)) continue;
    // Deliberately not the listing's `retried = false` condition: the
    // overview reports both sides of it in one pass (`retriedCount` counts
    // exactly what retried-hiding removes).
    if (log.retried) {
      retriedCount += 1;
      if (!options.showRetriedLogs) continue;
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
      options.folderDir === undefined
        ? []
        : deriveFolders(rows, options.folderDir),
  };
};

/** Facts the column *set* is built from — whole-universe by nature: a score
 *  column must exist even when the only log carrying its scorer sits on an
 *  unloaded page. See {@link readLogsColumnFacts}. */
export interface LogsColumnFacts {
  /** Distinct (scorer, metric) pairs across the scope — the score columns
   *  the listing offers (see `createLogColumnSchema`). */
  scorerMap: ScorerMap;
  /** Whether any in-scope log's samples ended with a limit — promotes the
   *  sampleLimits column to default-visible. */
  hasSampleLimits: boolean;
}

/**
 * One scan producing the facts the column schema is built from. A sibling
 * of {@link readLogsOverview}, but deliberately NOT a `LogsListingData`
 * method: instances are constructed *with* the schema these facts produce
 * (`createLogsListingData({ schema })`), so this read must sit upstream of
 * the instance — it consumes raw records only, never schema accessors.
 *
 * Membership is the scope *subtree* (`scopeDir` prefix), not the listing's
 * direct-children condition: a folder offers score columns from logs in
 * nested subfolders too. Retried runs contribute regardless of retried-
 * hiding — hiding a run doesn't retract its scorers.
 */
export const readLogsColumnFacts = async (
  logDir: string,
  scopeDir?: string
): Promise<LogsColumnFacts> => {
  // The subtree scan: an index range on the db path. The cache path can
  // serve a superset (an out-of-namespace listing arrives whole), so the
  // prefix re-applies per row below and in computeScorerMap.
  const rows = await scanRows(logDir, { prefix: scopeDir ?? logDir });
  const prefix = scopeDir === undefined ? undefined : scopePrefix(scopeDir);
  return {
    scorerMap: computeScorerMap(rows, scopeDir),
    hasSampleLimits: rows.some(
      (row) =>
        (prefix === undefined || row.name.startsWith(prefix)) &&
        (row.header?.sampleLimits.length ?? 0) > 0
    ),
  };
};

/** The log-side facts the cross-log samples page needs beside its sample
 *  rows. See {@link readSamplesLogFacts}. */
export interface SamplesLogFacts {
  /** In-scope log names after retried-hiding — the membership set sample
   *  rows join against (a sample displays iff its log is here). */
  fileNames: string[];
  /** Distinct task_ids among `fileNames` — the eval-set anti-join input
   *  (pending tasks are ones with no log yet). */
  taskIds: string[];
  /** Among `fileNames`, logs that have settled (status present and not
   *  "started") — the progress bar's numerator. */
  completedCount: number;
  /** Retried runs in scope pre-hiding — drives the "Show Retried Logs"
   *  toggle's visibility (both toggle states report the same count). */
  retriedCount: number;
}

/**
 * One subtree scan of the logs table producing the samples page's log-side
 * facts: which logs' samples display (membership, with retried-hiding
 * evaluated here so the view never re-derives the cross-row `retried`
 * mark), and the task progress counts. The samples page has no
 * `LogsListingData` instance — its rows come from the samples subsystem —
 * so this is a standalone read like {@link readLogsColumnFacts}.
 *
 * Membership is the `scopeDir` *subtree*, matching the samples read's
 * prefix scope. Retried marks stay group-complete under a subtree scan:
 * grouping keys on a row's exact parent directory, and a row is under the
 * prefix iff its parent directory is, so no group straddles the boundary.
 */
export const readSamplesLogFacts = async (
  logDir: string,
  scopeDir: string,
  options: { showRetriedLogs: boolean }
): Promise<SamplesLogFacts> => {
  const scanned = await scanRows(logDir, { prefix: scopeDir });
  const rows = computeLogsWithRetried(scanned);
  // Re-applied per row: the cache path can serve a superset (an
  // out-of-namespace listing arrives whole).
  const prefix = scopePrefix(scopeDir);
  const fileNames: string[] = [];
  const taskIds = new Set<string>();
  let completedCount = 0;
  let retriedCount = 0;
  for (const log of rows) {
    if (!log.name.startsWith(prefix)) continue;
    if (log.retried) {
      retriedCount += 1;
      if (!options.showRetriedLogs) continue;
    }
    fileNames.push(log.name);
    if (log.task_id) taskIds.add(log.task_id);
    if (log.status !== undefined && log.status !== "started") {
      completedCount += 1;
    }
  }
  return { fileNames, taskIds: [...taskIds], completedCount, retriedCount };
};

export interface LogsListingMatch {
  /** The matched record's key (`file_path`) — the view derives its display
   *  row id from it (`fileLogIdentity` is a pure function of the name). */
  id: string;
  /** Zero-based position in the filtered + sorted snapshot key list. */
  offset: number;
  /** Values needed to merge transient matching rows into file-match order. */
  orderValues?: Record<string, unknown>;
}

/** The find-only query inputs of {@link LogsListingData.getMatches} — all
 *  data, no view closures: matching runs against the schema's per-column
 *  search text, which mirrors the grid's display formatting (the parity
 *  test pins the two together). */
export interface LogsListingFindQuery {
  /** Sizes the snapshot build's inline first page when the match query is
   *  the one that builds it. */
  pageSize: number;
  term: string;
  /** The column ids whose text is searched — the view's visible columns,
   *  so matches agree with what the user sees on loaded rows. */
  searchColumns: readonly string[];
}

/**
 * Everything the view supplies to construct a {@link LogsListingData}:
 * where rows are read from (`logDir`) and the column schema queries are
 * evaluated through. No shaping and no membership — pages are stored
 * records (shaped into display rows above the interface, per page), and
 * membership arrives as filter conditions over schema columns
 * (`parent_dir`, `retried`).
 */
export interface LogsListingView {
  logDir: string;
  /** The column semantics conditions and sorts resolve against (see
   *  `createLogColumnSchema`). Carries its own cache identity (`key`) —
   *  the score-column schema lands asynchronously. */
  schema: LogColumnSchema;
}

/**
 * Data access for the log listing page — the seam between view code and
 * storage (design/listing-data-interface.md). Methods take a filter, a sort
 * order, and pagination, and return one page plus whole-result facts; what
 * sits behind them (today an IndexedDB scan, later a better local engine or
 * a server) is invisible above the interface, so nothing above it may be
 * tuned around the current implementation's cost profile.
 */
export interface LogsListingData<TRow> {
  /**
   * One page of the listing plus facts about the whole result set (the
   * footer's `total_count`, the pending anti-join's `universe_task_ids`).
   * All pages of one (filter, orderBy) slice a shared frozen snapshot, so
   * concurrent replication writes can't cause duplicates or gaps
   * mid-scroll; the write path's invalidation is what advances reads to
   * fresher data. Cursors are opaque positions in the filtered+sorted
   * result and work in both directions (a backward page is the slice
   * before the cursor; a null backward cursor starts from the end).
   */
  getPage(
    filter: Condition | undefined,
    orderBy: OrderByModel[] | undefined,
    pagination: Pagination
  ): Promise<LogsListingPageResult<TRow>>;

  /**
   * Rows whose searchable text contains the term across the WHOLE filtered
   * result — loaded and unloaded pages alike — in result order, with the
   * same offsets page cursors use (so "jump to this match" is "load pages
   * through this position"). Conceptually `getPage` with a different
   * projection; only the data layer can answer it, while all find
   * *behavior* (debounce, current match, loading through an offset) stays
   * above the interface.
   */
  getMatches(
    filter: Condition | undefined,
    orderBy: OrderByModel[] | undefined,
    find: LogsListingFindQuery
  ): Promise<LogsListingMatch[]>;

  /**
   * Aggregate facts about the scope beyond the queried rows — one scan
   * produces all of them. Takes named options rather than conditions
   * because its numbers deliberately span *different* membership variants
   * in one answer (see {@link readLogsOverview}).
   */
  getOverview(options: LogsOverviewOptions): Promise<LogsOverview>;
}

/** The active query's entry plus the previous one, which may still be
 *  serving placeholder rows; a changed filter or sort rescans anyway.
 *  Sizes both per-instance caches (snapshots, Find match contexts). The
 *  overview doesn't consume either, so it can't thrash the slots. */
const kSnapshotCacheEntries = 2;

/**
 * An epoch-stamped, promise-valued LRU — the shape the instance's listing
 * caches share (the snapshot cache, Find's match-context cache). Promise-
 * valued so concurrent reads of one key dedupe into a single build.
 * Entries are epoch-stamped (see logsListingEpoch): a bumped epoch means
 * the next read rebuilds and awaits, so an invalidated entry is never
 * served stale — the semantics the previous react-query placement needed
 * `fetchQuery` + `staleTime: Infinity` to encode. A failed build must not
 * serve as a durable success ("no items" over a populated database): it
 * evicts so the next read rebuilds — callers see the rejection; retry
 * policy stays with the react-query layer above.
 */
const epochStampedCache = <T>(
  maxEntries: number
): ((key: string, build: () => Promise<T>) => Promise<T>) => {
  const entries = new Map<string, { epoch: number; promise: Promise<T> }>();
  return (key, build) => {
    const epoch = logsListingEpoch();
    const cached = entries.get(key);
    if (cached !== undefined && cached.epoch === epoch) {
      // Re-insert so eviction order tracks recency, not first insertion.
      entries.delete(key);
      entries.set(key, cached);
      return cached.promise;
    }
    const entry = { epoch, promise: build() };
    entries.delete(key);
    entries.set(key, entry);
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
    entry.promise.catch(() => {
      if (entries.get(key) === entry) entries.delete(key);
    });
    return entry.promise;
  };
};

/**
 * Create the log listing's data access over today's storage: the two-tier
 * scan (one snapshot scan per (filter, orderBy), cheap key-slice pages —
 * see {@link LogsListingSnapshot}), with cache-only scopes (db-less
 * sessions, out-of-namespace dirs) served as one unpaged in-memory read.
 *
 * Construct one instance per view, memoized on the view inputs: the
 * snapshot cache lives in the instance, so a changed schema means a fresh
 * instance and a fresh cache.
 */
export const createLogsListingData = (
  view: LogsListingView
): LogsListingData<LogListingRow> => {
  const { logDir, schema } = view;

  const compilePlan = (
    filter: Condition | undefined,
    orderBy: OrderByModel[] | undefined
  ): DatabaseListingPlan<LogListingRow> =>
    createListingPlan({
      filter,
      orderBy,
      getValue: schema.getValue,
      getComparator: schema.getComparator,
      getFilterType: schema.getFilterType,
    });

  // Both caches key by the serialized query values — the filter
  // condition's value IS the cache identity (`toJSON` is deterministic for
  // a given construction; an equivalent condition built differently just
  // misses and rescans).
  const snapshotKey = (
    filter: Condition | undefined,
    orderBy: OrderByModel[] | undefined
  ): string => JSON.stringify([filter ?? null, orderBy ?? null]);

  const snapshots = epochStampedCache<LogsListingSnapshot>(
    kSnapshotCacheEntries
  );

  const fetchSnapshot = (
    filter: Condition | undefined,
    orderBy: OrderByModel[] | undefined,
    plan: DatabaseListingPlan<LogListingRow>,
    firstPageSize: number
  ): Promise<LogsListingSnapshot> =>
    snapshots(snapshotKey(filter, orderBy), () =>
      readLogsListingSnapshot(
        logDir,
        scanScopeFromFilter(logDir, filter),
        plan,
        firstPageSize
      )
    );

  // Find's term-independent inputs, cached beside the snapshot under the
  // same key and epoch semantics (the invalidation story is identical):
  // the match scan (a full store read + retried grouping + filter pass)
  // and the snapshot-offset map change only when the data or the query
  // changes, while the term changes per debounced keystroke — only the
  // `.includes(term)` pass depends on it. Without this, typing an 8-char
  // term over a 10k-log dir pays ~7 redundant full scans. Cost: the last
  // find's filtered records stay retained until the next epoch bump or
  // LRU eviction.
  const matchContexts = epochStampedCache<{
    records: LogListingRow[];
    offsetByKey: Map<string, number>;
  }>(kSnapshotCacheEntries);

  const getPage = async (
    filter: Condition | undefined,
    orderBy: OrderByModel[] | undefined,
    pagination: Pagination
  ): Promise<LogsListingPageResult<LogListingRow>> => {
    const plan = compilePlan(filter, orderBy);
    if (logsListingSource(logDir) === "cache") {
      // A scan per read: cache-only rows already live in memory, so this
      // stays the simpler, equally-cheap form — but the page contract still
      // holds (a mid-session source flip must not append the whole listing
      // as one giant "page" to a window of retained db-served pages).
      const records = await scanListingRecords(
        logDir,
        scanScopeFromFilter(logDir, filter),
        plan
      );
      const taskIds = new Set<string>();
      for (const log of records) {
        if (log.task_id) taskIds.add(log.task_id);
      }
      const { start, end, next_cursor } = pageBounds(
        records.length,
        pagination
      );
      return {
        items: records.slice(start, end),
        total_count: records.length,
        universe_task_ids: [...taskIds],
        next_cursor,
      };
    }
    const snapshot = await fetchSnapshot(
      filter,
      orderBy,
      plan,
      pagination.limit
    );
    const total = snapshot.total_count;
    const { start, end, next_cursor } = pageBounds(total, pagination);
    // The inline first page covers slices from 0 whenever it holds `end`
    // rows — or the whole (shorter) universe. A cached snapshot built under
    // another limit falls through to the bulkGet path.
    const items =
      start === 0 &&
      (snapshot.firstPage.length >= end || snapshot.firstPage.length === total)
        ? snapshot.firstPage.slice(0, end)
        : await readSnapshotPageRows(snapshot, plan, start, end - start);
    return {
      items,
      total_count: total,
      universe_task_ids: snapshot.task_ids,
      next_cursor,
    };
  };

  const getMatches = async (
    filter: Condition | undefined,
    orderBy: OrderByModel[] | undefined,
    find: LogsListingFindQuery
  ): Promise<LogsListingMatch[]> => {
    const plan = compilePlan(filter, orderBy);
    const scope = scanScopeFromFilter(logDir, filter);
    const term = find.term.toLowerCase();
    const rowText = (log: LogListingRow): string =>
      joinSearchText(
        find.searchColumns.map((columnId) =>
          schema.getSearchText(log, columnId)
        )
      );
    const toMatch = (log: LogListingRow, offset: number): LogsListingMatch => {
      const orderValues = orderBy?.length
        ? Object.fromEntries(
            orderBy.map(({ column }) => [column, schema.getValue(log, column)])
          )
        : undefined;
      const match = { id: log.name, offset };
      return orderValues === undefined ? match : { ...match, orderValues };
    };

    if (logsListingSource(logDir) === "cache") {
      const records = await scanListingRecords(logDir, scope, plan);
      const matches: LogsListingMatch[] = [];
      for (let offset = 0; offset < records.length; offset++) {
        const log = records[offset]!;
        if (rowText(log).includes(term)) {
          matches.push(toMatch(log, offset));
        }
      }
      return matches;
    }

    const { records, offsetByKey } = await matchContexts(
      snapshotKey(filter, orderBy),
      async () => {
        // The match scan doesn't consume the snapshot until the offset-map
        // build, so overlap the two store reads: on a cold snapshot (first
        // find per (filter, orderBy), post-invalidation rebuild) each is a
        // full table scan, and serializing them doubles the latency.
        // Unsorted scan: order comes from the snapshot's key positions, so
        // the plan's full-list sort would be built and discarded.
        const [snapshot, records] = await Promise.all([
          fetchSnapshot(filter, orderBy, plan, find.pageSize),
          scanListingRecords(logDir, scope, plan, { sorted: false }),
        ]);
        return {
          records,
          offsetByKey: new Map(
            snapshot.keys.map((key, offset) => [key, offset] as const)
          ),
        };
      }
    );
    const matches: LogsListingMatch[] = [];
    for (const log of records) {
      const offset = offsetByKey.get(log.name);
      if (offset !== undefined && rowText(log).includes(term)) {
        matches.push(toMatch(log, offset));
      }
    }
    matches.sort((a, b) => a.offset - b.offset);
    return matches;
  };

  return {
    getPage,
    getMatches,
    getOverview: (options) => readLogsOverview(logDir, schema, options),
  };
};
