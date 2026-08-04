# A data access interface for the log listing

Status: implemented on this branch (all three phases — see
"Implementation phases", including where the outcome exceeded the plan).
Companion to
[db-backed-listing-plan.md](db-backed-listing-plan.md), which documents the
paginated listing as it currently exists on this branch.

## Summary

The paginated log listing works, but its layering has problems: the data
layer depends on react-query internals, and view code (a React component)
decides which database records the listing includes. This doc proposes a
transitional restructuring:

1. Put all listing reads behind a small interface shaped like scout's
   server API: methods take a filter, a sort order, and pagination, and
   return one page of rows plus a total count.
2. Let the implementation of that interface be as inefficient as IndexedDB
   forces it to be (scan every record, hold results in memory) — but keep
   that cost invisible above the interface.
3. Move the "snapshot" cache (explained below) inside the implementation,
   replacing a react-query entry with a plain internal cache.
4. Encode the rules for which records appear in the listing ("membership")
   as filter conditions passed through the interface, instead of a function
   the view supplies.

The interface promises query semantics (filter, sort, page, count) and
says nothing about how they're computed. In the near term the
implementation is an inefficient full read of IndexedDB; later it might be
a better local store (for example SQLite compiled to WebAssembly) or
delegate to a server, as scout's does. Consumers cannot tell the
difference — that's the point. Higher-level code never learns that today's
implementation reads everything into memory, so nothing above the
interface gets built on that assumption.

## Background: how the listing reads data today

A replication service continuously syncs the view server's log directory
into IndexedDB in the browser. The listing UI reads from IndexedDB, not
from the server.

Because most useful filters and sorts cannot use an IndexedDB index (see
the constraints section of the plan doc), any filtered, sorted, counted
listing requires scanning every record in the scope. The branch pays for
that scan once per (filter, sort) combination and reuses it:

- **The snapshot.** One scan produces the ordered list of primary keys
  (file paths) of every record that matches the filter, in sort order.
  The count comes free (it's the list's length). This is cached.
- **Pages.** A page of 500 rows is served by slicing 500 keys out of the
  snapshot and bulk-reading just those records. Pages are cheap, and all
  pages of one query slice the same frozen ordering, so concurrent
  replication writes can't cause duplicates or gaps mid-scroll.
- **Freshness.** When replication writes new data, a throttled invalidation
  marks the cached snapshot and pages stale; they rebuild on next use.

That two-level scheme is sound and this proposal keeps it. The problems are
in *where* the pieces live.

## The problems

### 1. The data layer depends on react-query

The snapshot is cached as a react-query cache entry, and the page-reading
function fetches it by calling `queryClient.fetchQuery` from *inside*
another query's fetch function (`log_data/logsListingRead.ts`,
`fetchLogsListingSnapshot`). Correctness depends on subtle react-query
behavior: `staleTime: Infinity` meaning "fresh until explicitly
invalidated", and `fetchQuery` (not `ensureQueryData`) so that an
invalidated snapshot is rebuilt and awaited rather than served stale.

react-query is a UI-level caching library. Having the storage layer depend
on its cache semantics means none of this survives a storage swap, and
anyone touching the data layer must first understand react-query
internals.

### 2. A React component decides what's in the database's result set

The view supplies a function called `toRow` (built in `LogsPanel.tsx`) that
converts a stored record into a grid row — and also returns `undefined` for
records the current view should not list at all. Three rules hide inside
those `undefined` returns:

- In folder view, only records directly inside the current directory are
  listed (not records in subdirectories).
- When "Show Retried Logs" is off, records marked as retried runs are
  dropped.
- Records whose file names don't parse as valid log identities are dropped.

Each of these is a predicate over stored data — a WHERE clause — but it's
implemented as JavaScript closed over component state. That has already
produced visible scar tissue:

- **The `universe` string.** Cache keys must be plain values, and `toRow`
  is a function, so a string (`mode + directory + retried-toggle`) is
  manually maintained as a stand-in for "which version of `toRow` produced
  these rows". Forgetting to include something in this string is a stale
  cache bug.
- **A duplicated scan prefix.** The query also carries a directory prefix
  that narrows the scan, which must be kept manually consistent with what
  `toRow` accepts. A code comment warns that getting this wrong "would
  silently drop matching rows". Two representations of one fact,
  coordinated only by a comment.
- **The rules are implemented three times.** Once in `toRow` for the
  listing, once in `isCandidate` for the overview (aggregate counts,
  folder list), and retried-hiding a third time inside `readLogsOverview`
  itself. Nothing enforces that they agree.

### 3. Filters and sorts are evaluated through view code

A filter like "score > 0.5" names a *grid column*, not a stored field.
There is no declared mapping from column name to stored data. Instead the
query evaluator calls the grid's own column accessor functions
(`getValue`, `getComparator`, `getFilterType` from `useLogListColumns`) to
read and compare values. Those functions close over the score schema,
which arrives asynchronously — so a second stand-in string
(`accessorsKey`) exists to key caches by "which version of the accessors
was in effect".

This one is the hardest to fully fix (see "What we are deliberately not
doing yet"), but the proposal shrinks it.

## The proposal

### The boundary rule

The single sentence the restructuring enforces, in both directions:

> UI components produce `Condition`/`OrderBy` values and consume rows.
> All evaluation of those values — what a column name means, how it
> compares, what matches — lives in the data layer.

The leak runs both ways today: view code decides membership (the `toRow`
problem above), and the data layer evaluates queries through grid column
definitions — `accessorFn`, `sortComparator`, and `filterType` are fused
with React cell renderers inside `useLogListColumns`, so the storage layer
borrows the grid's display config for its evaluation semantics. The
`accessorsKey` string is that symptom: query semantics trapped inside a
React hook whose inputs arrive asynchronously. Consequences for where code
lives:

- `evaluator.ts`, `planner.ts`, and `applyListingQuery` move out of
  `app/log-list/listing/` into the data layer — they are query-evaluation
  machinery sitting in the view tree.
- `combineFilters` (grid filter state → `Condition`) stays in the view:
  translating UI state into the declarative query language is exactly what
  components should do.
- Two things are still *invoked* above the interface without violating the
  rule, provided their logic is imported from the data layer rather than
  defined in the view: the pending-task overlay (rows with no database
  record, filtered/sorted/merged in memory by necessity — it must call the
  data layer's evaluator and comparator builder, not carry its own) and
  the find band's searchable-text function (genuinely view-defined
  formatting; see `getMatches`).

### One interface, scout's shape

Scout's UI queries a server: `getTranscripts(dir, filter, orderBy,
pagination)` returns one page plus a total count, and the UI wraps that in
react-query hooks. We adopt the same shape. What sits behind it — today's
IndexedDB scan, a better local engine, or a server call — is an
implementation choice consumers never see.

The interface needs more than one method, because the listing page needs
more than rows:

```ts
interface LogListingData {
  // One page of the listing, plus facts about the whole result set.
  getPage(
    filter: Condition | undefined,
    orderBy: OrderByModel[] | undefined,
    pagination: Pagination
  ): Promise<{
    // This page's stored records (with derived columns like `retried`
    // attached). Shaping into display rows happens above the interface,
    // per page, so returned items are data and the internal cache can be
    // keyed by (filter, orderBy) alone. Returning shaped rows would drag
    // view-only shaping inputs — the tasks/logs mode that picks URL and
    // display-name shape, which no condition captures — back into cache
    // identity: the `universe` string under a new name.
    items: LogRecord[];
    // Count of ALL rows matching the filter, not just this page — the
    // footer count.
    totalCount: number;
    // Distinct task_ids across ALL matching rows. The pending-task
    // overlay drops a "pending" row once any real row exists for its
    // task; with pagination, the loaded pages alone can't prove a row
    // does NOT exist, so this whole-result fact rides along.
    universeTaskIds: string[];
    nextCursor: Cursor | null;
  }>;

  // Rows whose searchable text contains the term, across the WHOLE
  // result — loaded and unloaded pages alike — in result order. Backs
  // the Find band.
  getMatches(
    filter: Condition | undefined,
    orderBy: OrderByModel[] | undefined,
    term: string
  ): Promise<Array<{
    // Stable row id — drives match highlighting and selection.
    id: string;
    // Index in the filtered+sorted result: the same coordinate page
    // cursors use, so "jump to this match" becomes "load pages through
    // this position".
    position: number;
    // The row's sort-column values, so rows that exist only in memory
    // (pending tasks) can be merge-sorted into match order above the
    // interface without loading the matched row itself.
    orderValues?: Record<string, unknown>;
  }>>;

  // Aggregates about a directory that the listing page needs beyond the
  // queried rows — one scan produces all of them.
  getOverview(
    dir: string,
    options: {
      // Folder view: also derive this directory's immediate
      // subdirectories (name + log count each).
      folderDir?: string;
      // Affects the counts below, mirroring the listing's own
      // retried-hiding.
      showRetriedLogs: boolean;
    }
  ): Promise<{
    // Distinct task_ids anywhere under dir — the pending-task overlay's
    // input (deliberately wider than the current filter).
    taskIds: string[];
    // Rows in the view universe (retried-hidden excluded).
    fileCount: number;
    // Of those, logs still running.
    startedCount: number;
    // Rows that retried-hiding removed — drives whether the
    // "Show Retried Logs" toggle appears at all.
    retriedCount: number;
    // Set when exactly one row exists (single-log workspace redirect).
    soleFileName?: string;
    folders: Array<{ name: string; itemCount: number }>;
  }>;
}
```

Why `getMatches` is on the interface at all, rather than an implementation
detail: find results must be true across the *whole* filtered result — the
match count and jump-to-match navigation include rows on pages that were
never loaded, which only the data layer can answer. What stays above the
interface is all the find *behavior*: debouncing the typed term, tracking
the current match, and asking the page query to load pages through an
unloaded match's position. Pulling matches inside the implementation would
force that UI state down with it. So it's a query method — conceptually
`getPage` with a different projection (positions instead of rows).

One honest wart in `getMatches`, as designed: it cannot be expressed as a
filter condition, because matching runs against a row's *on-screen text* —
the formatted cell values of the currently visible columns (a formatted
date, a model's display name) — which stored fields can't reproduce. So
the function that produces a row's searchable text was expected to be
view code crossing the interface, transitionally. *Resolved:* the column
schema now carries per-column *search text* (the same display formatting
the grid's `textValue` applies — the parity test pins the two together),
so `getMatches` takes only data: the visible column ids and the term.
Match ids likewise became record keys, with the view deriving display row
ids from them (`fileLogIdentity` is a pure function of the name). Nothing
crossing the interface is a function anymore.

Why `getOverview` is a separate method rather than a `getPage` variant:
its numbers deliberately span *different* membership rules in one answer —
`retriedCount` counts exactly the rows the listing's filter excludes,
`taskIds` covers the whole directory regardless of the current filter, and
`folders` derives from the recursive universe while the folder-view
listing shows only direct children. No single filter produces all of
those, but one scan does.

The react-query hooks (`useDatabaseLogsListingQuery` and friends) stay, but
become thin wrappers that call these methods — exactly how scout's
`useServerTranscriptsInfinite` wraps `api.getTranscripts`. No query ever
fetches another query from inside its fetch function.

Pagination uses scout's `Pagination` shape
(`packages/inspect-common/src/query/types.ts`): a cursor, a direction
(`"forward"` or `"backward"`), and a limit. Cursors stay opaque to callers
and mean "position in the filtered and sorted result". Today's
implementation realizes that as an offset into the snapshot's key list; a
future SQL implementation can realize it differently without changing any
caller. (The Find band's "load pages until this position is loaded"
behavior already uses exactly this meaning, so it survives unchanged.)

The interface supports both directions from the start, even though today's
UI only pages forward (the grid has no scroll-up fetch trigger, and the
react-query hook keeps every loaded page rather than a bounded window).
Backward support costs almost nothing here — with an offset cursor, the
backward page is just the key-list slice *before* the cursor — whereas
scout's keyset cursors make backward paging genuinely harder. And it's
needed soon: the planned bounded-window rework (drop far-away pages, fetch
pages on demand as the user scrolls back up) is exactly a consumer of
backward paging. Building the interface without `direction` would bake
today's forward-only UI behavior into the layer that's supposed to outlive
it.

### The snapshot becomes a private cache

The implementation keeps the scan-once-page-cheap scheme, but the snapshot
moves from a react-query entry to an ordinary cache inside the
implementation, keyed by the (filter, orderBy) values. A cache of one or
two entries is enough: the listing re-reads the same query repeatedly, and
a changed filter or sort means a fresh scan anyway.

What the react-query placement currently provides, and how the internal
cache replaces it:

| react-query gave us | replacement |
| --- | --- |
| Deduplication (concurrent page fetches and the Find query share one scan) | cache the *promise*, not just the result |
| Reuse across pages | the cache itself |
| Eviction (`gcTime`) | one/two entries, overwritten on key change — strictly less memory |
| Invalidation via the shared key root | an explicit step, below |
| No stale-value trap (`fetchQuery` vs `ensureQueryData`) | not needed — "cleared means the next call rebuilds and awaits" is the obvious semantics of a plain cache |

**Invalidation** uses an epoch counter rather than an ordered two-step:
the write path bumps a module-level epoch (and then invalidates the
react-query keys, as today), and every cached snapshot records the epoch
it was built under. A read that finds its entry's epoch stale rebuilds.
The required ordering — refetches must not be served the pre-write
snapshot — holds by construction instead of by call-site discipline:
there is no clear-then-invalidate sequence to get wrong, and per-view
instances need no registration with the write path.

One thrash hazard to design around: the listing query and the overview run
*different* filters (the overview needs the unfiltered universe, and counts
that include what retried-hiding removed). A single-entry cache shared by
both would rebuild on every alternation. Give them separate slots, or key
the cache by the full filter value with room for both.

### Membership becomes filter conditions

The rules currently hidden in `toRow`'s `undefined` returns move into the
filter `Condition` passed through the interface. The view composes
`scopeCondition AND userFilter` and hands over one condition. The rules
still *originate* in the view (only the view knows it's in folder mode),
but as declarative data the implementation can execute, test, and
eventually compile to SQL — not as a closure it must trust.

Checked against the actual condition language
(`packages/inspect-common/src/query/types.ts`, SQL-style operators):

- **Folder view (direct children only).** Expressible today as
  `name LIKE 'dir/%' AND name NOT LIKE 'dir/%/%'`, but LIKE requires
  wildcard-escaping paths containing `%` or `_` — a silent-corruption
  hazard. Cleaner: a `parent_dir` column (`parent_dir = 'dir'`), derivable
  from the file path during the scan now, and a real stored (and indexed)
  column later. *Landed:* `parent_dir` is now stored and indexed at write
  time (derived from the immutable `file_path`, so it can't go stale;
  recreate-on-mismatch covers migration), and a filter that pins it scans
  the index — exactly the direct children — instead of ranging over the
  subtree. This is the first membership term to become an indexed WHERE
  clause, as promised.
- **Retried-hiding.** `retried = false`, with the derived column made
  *total*: the derivation emits `false` for group winners and task-id-less
  logs alike, `true` only for actual retried runs. Today
  `computeLogsWithRetried` leaves task-id-less logs `undefined`, and the
  condition evaluator implements SQL three-valued logic (NULL fails
  negative operators too) — so the natural `retried != true` would
  silently drop every task-id-less log. A total boolean sidesteps null
  semantics entirely. "Retried" is still computed by *grouping* rows
  during the scan, not stored per record; the implementation derives it
  before filtering, so it is queryable immediately. *Decided against
  persisting it at write time* (unlike `parent_dir`): the mark is a
  cross-row derivation over live statuses — a preview write flipping one
  log's status can change its group's winner, so a stored column would
  need sibling-group recomputation on every keyed write, a new invariant
  to maintain — and as a low-selectivity boolean it would buy almost
  nothing as an index while the scan-time derivation is already cheap.
  Revisit only if an index-backed snapshot build ever needs `retried`
  without scanning.
- **Valid log identity.** A parse check, not expressible in the operator
  set — and it shouldn't be. Either replication already only writes rows
  that parse (verify this), or a validity flag gets stored at write time
  and the condition is `IS NOT NULL` on it. Bookkeeping either way.

With membership encoded this way, `toRow` shrinks to pure shaping (record →
display row), applied only to the returned page, above the interface. What
gets deleted as a consequence:

- the `universe` string — the filter condition's value *is* the cache key;
- the manually-coordinated scan prefix — the directory scope is in the
  condition;
- the three separate implementations of the membership rules.

One caution: nothing shaping-only (like the click-through URL, which
depends on the current directory) may sneak back into cache identity.
Shaping runs per page above the interface, so it shouldn't need to.

### Two kinds of column names, one resolver

Encoding membership as conditions means condition columns now come from two
places:

- **Record-level columns** (`name`, `parent_dir`, `retried`, `task_id`,
  `status`, `mtime`, …): evaluated by the implementation directly against
  stored records. These are the terms a future backend can push into
  indexed WHERE clauses.
- **View-level columns** (`score_<scorer>/<metric>`, `percentCompleted`,
  `model`, …): still evaluated through the grid's accessor functions over
  shaped rows, because no declared mapping from these names to stored data
  exists yet.

The implementation's condition evaluator therefore needs a resolver: try
the record-level schema first, fall back to the view accessors. That
resolver is the beginning of a declared column schema — it can grow one
column at a time as mappings get written down, shrinking the view-level
residue, instead of requiring a big-bang schema migration.

Until the residue is gone, the accessor functions still have to reach the
implementation somehow. Decided: **construct the data-access object per
view**, passing accessors in once, held by a memo keyed on `accessorsKey`
(the score schema arrives asynchronously). The internal cache lives in the
instance, so a schema arrival means a new instance and a fresh cache — the
lifecycle problem solves itself, and `accessorsKey` disappears from
data-layer cache keys (it remains in the react-query hook keys, which is
where caching results by schema belongs).

The accessors themselves also stop being view code. A plain (non-React)
column-semantics module in the data layer — `columnSchema(scorerMap)` →
per-column `{ getValue, comparator, filterType }`, covering the static
columns and the dynamic score/metric columns (the score schema already
lives in `log_data/scoreSchema.ts`; only its consumption is React-shaped
today) — becomes the source of truth. The grid consumes it for its column
defs' `accessorFn`/`meta`, the data-access factory takes it directly, and
display config can no longer drift from query semantics. The "view-level
residue" then means "evaluated over shaped rows" (transitional), not
"owned by React code".

Be precise about what these warts cost: a function cannot be serialized.
Any closure crossing the interface (the view-level accessors here, the
searchable-text function in `getMatches`) is compatible with a local
implementation only. A server-backed implementation is blocked until the
condition columns and searchable text it needs are expressible as data.
So the exit paths aren't just cleanliness — they're prerequisites for one
of the futures this interface exists to allow.

**Outcome (phase 3): the residue collapsed further than planned.**
`buildLogListRow` turned out to be a pure projection — every data column
reads off ingestion-derived record fields — so the column-semantics module
(`createLogColumnSchema`) could be written entirely over stored records,
score/metric columns included (they resolve dynamically by name shape from
the scorer map, never pre-expanded). Evaluation therefore never touches
shaped rows or view accessors at all: the instance is constructed from
just `(logDir, schema)`, per-call accessors never happened, and the
"resolver" is simply the schema's own resolution (membership columns,
declared data columns, raw-field fallback for unknown ids). The last
residue — `getMatches`' `rowText`/`getRowId` closures — fell in a
follow-up: the schema carries per-column search text and matches identify
records by key (see the `getMatches` section). Every interface input is
now data; no serialization blocker remains on a server-backed
implementation.

## What we are deliberately not doing yet

- **Declaring the full column schema.** Score columns are an open-ended
  namespace (`score_<scorer>/<metric>`) that will never be pre-expanded
  into real columns; some display columns are computed in view code. The
  general fix — evaluate every condition against stored data, via declared
  fields or JSON paths — is where a real database eventually forces us,
  but it's not required to fix the layering. The resolver above lets it
  happen incrementally.
- **Leaving IndexedDB.** A full scan per (filter, sort) is unavoidable in
  the general case on *any* backend without a per-path index. What is
  IndexedDB-specific is the cost profile: every record must cross into
  JavaScript to be tested (structured-clone deserialization), and sorting
  requires holding the full row set in JS memory. A real engine — a local
  one, or one behind a server — scans with filter pushdown and page-sized
  memory. That's why the interface promises *semantics* (filter, sort,
  page, count) and stays silent about cost — the scan survives the backend
  swap; its cost profile doesn't; so nothing above the interface may be
  tuned around it.
- **Changing the paging scheme.** Frozen-ordering snapshots with
  offset-based cursors stay. Scout's keyset cursors need index-walkable
  sorts, which IndexedDB can't provide for realistic queries (see the plan
  doc's constraints).

## Consequences

Gains:

- The data layer is react-query-free; the storage swap surface is one
  interface.
- Membership rules are declarative, executed in one place, and become
  indexable query terms on a future backend.
- The `universe` string, the duplicated scan prefix, and the
  query-inside-query mechanism are deleted.
- Cache-only fallback modes (database failed to open, out-of-namespace
  directories) become invisible implementation details of the interface.

Costs:

- Invalidation coordination is now ours: the epoch scheme makes the
  ordering hold by construction, but it is hand-rolled state where
  react-query previously owned the lifecycle.
- The internal cache is hand-rolled state: it must cache promises for
  deduplication, and must be per-instance (or resettable) so tests don't
  fight singleton state.
- A slightly weaker consistency guarantee: today, all pages of one
  react-query refetch cycle provably share one snapshot. With a small
  internal cache, a filter change mid-scroll evicts the old entry; in
  practice old-key page windows are unobserved and don't refetch, so this
  is a comment, not a mechanism — but it's a real difference.
- Prerequisites: derive `parent_dir` and `retried` as queryable columns in
  the implementation now; persist them at write time later; verify (or
  enforce) at the write path that only valid log identities are written.

## Resolved questions

- **`getPage` returns stored records**, shaped above the interface per
  page (see the interface sketch). The snapshot's inline first page holds
  records too, or is dropped.
- **`getOverview` keeps named options** rather than conditions: the method
  deliberately reports across several membership variants in one scan;
  forcing them into conditions would be symmetry for its own sake.
- **Per-view construction** for the transitional accessors, with the
  column-semantics module as their source (see "Two kinds of column
  names").
- **`retried` is a total boolean column** and the condition is
  `retried = false` (see the membership section for the three-valued-logic
  trap that rules out `retried != true`).
- **The samples listing adopts the interface later** — it has no
  database-backed path yet; nothing forces convergence now.

- **The "valid log identity" rule doesn't exist** (verified during phase
  2): `fileLogIdentity` returns `undefined` only for the folder-scope case
  — it is pure path scoping, not a parse check. Membership is two
  conditions (`parent_dir`, `retried`), not three.
- **A scope key survives the `universe` string's deletion** — but as the
  panel's existing `mode::currentDir` grid-state key, not a hand-maintained
  cache stand-in. It carries what shaping reads beyond the record and the
  filter (the tasks/logs mode that picks URL shape); display toggles like
  retried-hiding live in the filter, so toggling them now keeps previous
  rows as placeholder data instead of blanking.

## Implementation phases

Each phase lands independently green:

1. **Extract the interface, internalize the snapshot.** Define the
   data-access factory; move the snapshot from a react-query entry to an
   instance-level promise cache (a small keyed map, so the listing and
   overview reads don't thrash each other) with epoch invalidation. The
   hooks become thin wrappers; `databaseLogsListingSnapshotKey` and
   `fetchLogsListingSnapshot` are deleted. Behavior-neutral. (As landed,
   this phase also moved `evaluator.ts`/`planner.ts` into the data layer —
   originally slated for phase 3 — because the factory compiles plans
   internally and must not import upward from `app/`.)
2. **Membership becomes conditions.** Derive `parent_dir` and total
   `retried` as record-level queryable columns during the scan; the view
   composes `scope AND userFilter`; the implementation derives its scan
   prefix from the condition (the optimization survives, the duplication
   dies); `toRow` shrinks to pure shaping. The `universe` string, the
   duplicated prefix, and `isCandidate` are deleted.
3. **Column semantics and the resolver.** Extract the column-semantics
   module from `useLogListColumns`; move `applyListingQuery` into the
   data layer; `getPage` switches to records-out with shaping lifted into
   the view. As landed, the schema came out fully record-level, so the
   planned shaped-row fallback was never needed — see the outcome note in
   "Two kinds of column names". A parity test
   (`schemaParity.test.tsx`) pins the schema's record values to the grid
   accessors' shaped-row values for every column, turning the projection
   assumption into an invariant.
