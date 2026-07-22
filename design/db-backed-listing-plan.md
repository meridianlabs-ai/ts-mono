# DB-backed listing queries (filter / sort / count / paginate in Dexie)

> **Status.** The logs listing is now db-first: `readLogsListing`
> (`log_data/logsListingRead.ts`) is the row source — the queryFn scans the
> scope, marks retried runs, shapes records per view (`fileLogItem` owns
> row-universe membership), and runs the plan; the grid no longer queries a
> memory-resident row list, and the synchronous in-memory fallback is gone.
> Where rows come from is an explicit scope-level dispatch
> (`logsListingSource`: `"database"` | `"cache"`), the `last_synced` gate is
> removed (reads serve warm/partial data; write-path invalidation streams
> updates in), and pending tasks merge into the page as a sorted overlay
> (`mergeSortedRows`).
>
> The page around the grid is also pagination-fenced. All full-list
> derivations sit behind read-layer projections that share
> `scanListingRows` (each becomes a snapshot projection under keys-first,
> so pagination changes only this module):
>
> - `readLogsOverview` — folders, pending anti-join `taskIds`,
>   progress/footer counts, retried presence, sole-file redirect. LogsPanel
>   no longer subscribes to `useLogListing`.
> - `readLogsListingMatches` — the find band's data-level backing. File
>   matches carry ids + offsets in the same cached snapshot ordering as
>   page cursors; folders/pending match locally. Count, "no results", and
>   navigation are universe-wide: selecting an unloaded match asks the
>   sequential query to load pages through its offset, then DataGrid's
>   existing delayed-selection effect scrolls when the row arrives. This
>   is the lossless interim form; the range-driven rework can replace the
>   load-through with a direct offset-addressed window later.
> - Restore-by-offset (decided over restore-by-loaded-rows): resolve the
>   persisted `selectedRowId` to its offset in the filtered+sorted
>   universe, fetch pages through it, then scroll. A `readLogsListingOffset`
>   seam was pinned here (`a30188e8`, with signature + tests) and later
>   removed as dead code while unwired (DataGrid's `rows.findIndex` restore
>   is correct while pages are complete). Under keys-first snapshots the
>   scan-based implementation is superseded anyway — the offset becomes a
>   key-list lookup on the snapshot (step 5 below), so re-derive from the
>   snapshot service rather than restoring the scan version verbatim.
>
> Keys-first pagination (the logs half of steps 2–4) is landed:
> `readLogsListingSnapshot` (`log_data/logsListingRead.ts` — beside the
> scan it wraps, not on `DatabaseService` as step 2 sketched) builds the
> tier-1 snapshot: the ordered PK list + `total_count`, the scan's retried
> marks per key (a page's `bulkGet` can't re-derive a cross-row fact), and
> the first page shaped inline. `readLogsListingPage` composes pages over
> it per decision 3 (see the decision for the `fetchQuery` amendment), and
> `useDatabaseLogsListingQuery` is a real `useInfiniteQuery` — 500-row
> pages, same-universe placeholders, cache-only scopes falling back inside
> the same queryFn — returning
> `{ result, hasNextPage, fetchNextPage, ensureOffsetLoaded,
> autoFetchPaused }` to feed the
> shared DataGrid's scroll-near-end trigger (scout's 2,000px threshold;
> commit-driven fetch chaining pauses on a settled error). The page window
> is deliberately *uncapped*: `maxPages` landed and was rescinded — see
> decision 3's amendment — so the interim memory story leans on step 7 not
> having happened yet, and bounded windows arrive with the range-driven
> rework (its own section below). Parity tests in
> `log_data/logsListingRead.test.ts` hold the paged path equal to
> `applyListingQuery` page-by-page, plus staleness (dropped holes),
> invalidation-rebuild, and first-page-seeding coverage.
>
> Still open, in rough value order:
>
> - Chunked listing *ingestion* (its own section below) — the dominant
>   cold-load cost on a huge dir.
> - Step 1's full form (index choice + residual predicate): only the plan
>   compiler + evaluator exist. Blocked on persisting `retried` (see the
>   retried-marking constraint) — until then every snapshot rebuild is the
>   intended transitional O(scope) scan, re-run per throttled invalidation
>   during a sync burst.
> - The range-driven page-query rework (its own section below): replace
>   the sequential `useInfiniteQuery` window with offset-addressed pages
>   driven by the virtualizer's visible range. Prerequisite for bounded
>   direct jumps and the remaining step 5 features; bounds window memory
>   for real (with step 7).
> - Step 7 mirror demotion — the react-query logs mirror still holds every
>   row, so steady-state memory stays O(dir) no matter how the read path
>   paginates.
> - The samples halves of steps 2–4: `/samples` still runs the in-memory
>   `useLogsListingQuery` over the full row list.
> - Step 5's remaining long tail: adjacent-sample nav and selected-row
>   restore from the snapshot key list — consumers of the range-driven
>   rework's jump-to-offset primitive.
> - Step 3's scope-prefix invalidation: writes still invalidate the whole
>   listing root (throttled), not just listings whose scope contains the
>   written file — equivalent with one grid mounted, wasteful once several
>   scopes hold cached listings.
> - The columns schema (`useScoreSchema` / `hasSampleLimits` in
>   `grid/columns/hooks.tsx`) — the last full-list subscriber on the list
>   page, a candidate for another overview-style aggregate.
> - Step 6 cleanup.

The `/tasks`, `/logs`, and `/samples` pages sort and filter via `Condition` /
`OrderBy` types copied from scout. Scout ships the condition to its server,
which compiles it to SQL and returns one page plus a total count; inspect
replicates data into IndexedDB but still reads **entire tables into memory**
and filters/sorts/counts there. This plan moves that work into Dexie queries,
adds infinite scrolling via react-query `useInfiniteQuery` (an interim shape —
see "Range-driven page queries" for where paging is headed), and keeps the API
client interface unchanged (the query layer sits *above* the api, unlike
scout's). Target UX: scout's transcripts page — cursor-paged rows, a filtered
`total_count` in the footer, `keepPreviousData` across re-filters.

**Finish line.** IndexedDB is the store; steady-state memory holds only the
snapshot key lists and the loaded pages (plus the eager presentation
overlays). And the streaming invariant must survive every phase: reads are
never gated on sync state — a cold sync renders partial results
immediately, and the write path's coalesced invalidation streams the rest
in while `keepPreviousData` keeps rows on screen across refetches. People
point this UI at very large S3 buckets; the cold-load budget there is
dominated by listing ingestion (its own section below), not by the read
path.

Three design decisions are already settled from prior discussion:

1. **Keys-first snapshots** (not scout-style keyset cursors): one scan per
   `(scope, filter, orderBy)` produces an ordered primary-key list; the count
   is `keys.length` for free; each page is a cheap `bulkGet` of a key slice
   with cursor `{ offset }` into the snapshot. Pages are mutually consistent
   under concurrent replication writes (no dupes/gaps mid-scroll), which
   neither live-offset nor keyset gives us.
2. **Dexie's limits are acceptable.** We are not chasing SQL-grade query
   planning; the win is ordered index iteration, early exit, not
   materializing every record into JS rows, and correct counts.
3. **Two-tier react-query snapshot placement** (not a module-level LRU).
   Tier 1 is a *snapshot query* — the ordered key list + `total_count` —
   keyed by the existing `databaseLogsListingKey` builder plus a
   `"snapshot"` suffix, so the universe slot, `listingKeyUniverse`, and
   the throttled root-key invalidation all keep working unchanged. Tier 2
   is the `useInfiniteQuery` pages, whose queryFn obtains the snapshot
   through the query cache — implemented as `queryClient.fetchQuery` with
   `staleTime: Infinity`, amending the original `ensureQueryData` sketch:
   the snapshot query has no observers, and after an invalidation
   `ensureQueryData` resolves with the stale keys (rebuilding only in the
   background), so a sync's *final* write would never reach the grid —
   breaking the streaming invariant. `fetchQuery` awaits the rebuild
   exactly when invalidated and serves from cache otherwise. Either way,
   concurrent page fetches dedupe into one build, later pages reuse it,
   and lifecycle is plain `gcTime` rather than hand-rolled eviction.
   Invalidation stays the one existing seam — a
   write burst marks both tiers stale, the snapshot rebuilds once, pages
   re-derive as cheap `bulkGet`s. (A module-level LRU avoids the
   query-inside-query pattern but re-creates singleton-state test pain and
   needs its own eviction + invalidation coupling.) Two requirements rode
   on this decision. The first stands: the snapshot build **returns the
   first page inline** (it shaped those rows anyway), so the read path
   adds no waterfall over today's one-read flow. The second — the page
   queries set **`maxPages`** so a long scroll doesn't reassemble the full
   list in memory — is **rescinded**: it landed and was removed. react-query
   drops capped pages off the *front*, and with no `getPreviousPageParam`,
   no `fetchPreviousPage` caller, and no scroll-up trigger, the head rows
   were unrecoverable for the life of the query key while the rendered
   window slid under a fixed scroll position (each capped fetch also
   re-satisfied the grid's near-end check, auto-paging through the whole
   dir until `autoFetchPaused` gated chaining). The "refetch on
   scroll-back" this decision priced in was never built — and a cap wins
   no memory anyway while step 7's mirror still holds every row. Bounded
   windows return with the range-driven rework (below), which drops pages
   by *observation* (plain `gcTime`) instead of recency-of-fetch, so
   scroll-back refetching falls out instead of needing a mechanism.

## Range-driven page queries (the pagination endgame)

The `useInfiniteQuery` window is *sequential*: pages accumulate from
offset 0 and the only motion is "append the next page". But the keys-first
snapshot (decision 1) gives O(1) random access to any offset —
`keys.slice(offset, offset + limit)` + `bulkGet` — and every deferred
step 5 feature reduces to a jump-to-offset the sequential window can't
express: find-match navigation past the loaded pages (jump to the match's
offset in the snapshot key list), selected-row restore (resolve the
persisted id to its key-list offset, jump there), adjacent-sample nav
(the key list *is* the adjacency list). `useInfiniteQuery` fits scout —
keyset cursors genuinely only support "next page after this one" — but
under keys-first it's the wrong abstraction.

The rework replaces the one infinite query with **offset-addressed page
queries driven by the virtualizer's visible range**:

- The virtualizer's `count` becomes the snapshot's `total_count`, not the
  loaded row count — the scrollbar represents the whole universe, and
  jumping anywhere is `scrollToIndex`. Rows without a loaded page render
  as skeletons.
- The visible range (plus overscan) determines the needed page indices;
  each page is its own query keyed
  `(universe, accessorsKey, filter, orderBy, pageIndex)` whose queryFn is
  `readLogsListingPage` at `{ offset: pageIndex * pageSize }` (one
  `useQueries` over the needed indices; the snapshot tier already dedupes
  concurrent builds).
- No `maxPages` semantics at all: pages that scroll out of observation
  drop via plain `gcTime`, and scroll-back refetches naturally —
  "refetch-on-scroll-back" becomes emergent behavior instead of an
  unbuilt promise. Window memory is bounded by the *observed* range
  (real once step 7 demotes the mirror).
- Invalidation gets cheaper: only observed pages refetch (unobserved ones
  go stale and refetch on next observation), vs. an infinite query
  refetching every loaded page per invalidation.

The design question to settle before building (the genuinely tricky bit):
the **same-universe no-blank-flash guarantee**. Today `placeholderData` on
the one infinite query keeps the previous window on screen across
re-filters/sorts within a universe. Per-page placeholders are the wrong
tool — page N's previous contents under a different filter are the wrong
rows to show at position N (row counts and order both changed) — so the
hold needs to live at the listing level: keep the previous
(filter, orderBy)'s rendered window + total on screen until the new
snapshot's first observed pages land, then swap atomically.

Sequencing: independent of the samples halves, step 3, and step 7 — but
do it *before* any step 5 feature. Each of those is a `scrollToIndex` on
top of the rework; built on the sequential window instead, each would be
throwaway contortion (e.g. "fetchNextPage in a loop until the target row
loads").

## Foundation already landed

### Derived columns stored at ingestion (#421)

Listing fields are computed once at write time and stored on the rows —
grid columns project stored values and must never re-derive:

- `Log.derived` (`LogDerived`): `total_tokens`, `duration`, `task_args`,
  `percent_completed`, `sample_limits`, and `scores` (scorer → metric →
  value). Attached by `detailTier()` in
  `apps/inspect/src/client/utils/type-utils.ts`, so the react-query cache
  and IndexedDB share one computation.
- `SampleSummaryRecord.derived` (`SampleDerived`): `tokens`, `input`,
  `target`, `fallbacks`, `scores` (name → raw value). Payloads are
  normalized once via `prepareLogDetails()`; both stores consume the same
  `PreparedLogDetails`.
- Derivation lives in `apps/inspect/src/client/utils/derive.ts` under
  `DERIVE_VERSION`, folded into `DB_VERSION` (`SCHEMA_VERSION * 100 +
  DERIVE_VERSION` in `client/database/schema.ts`) — any derivation change
  invalidates stored rows via the recreate-on-mismatch wipe.
- Deliberately NOT stored: log-level context on sample rows (task / model /
  status / created). It would go stale when the log row changes tier
  (running → success arrives via a preview refresh that doesn't rewrite
  samples). It stays a read-time join — see "sample scans join the logs
  table" below.

### Unified per-origin database (#421)

One `InspectAI` database per origin; `file_path` (a full path/URI) is the
identity, so overlapping dirs (`/logs`, `/logs/important`) share rows and
replicate once. "Current log dir" is a **query scope** — a boundary-safe
prefix (`scopePrefix()` guarantees `/logs/important` ≠ `/logs/important-2`)
threaded through `readLogs`, `readSampleSummaries`, `getCacheStats`,
`clearScope`, and engine seeding. A `sync_scopes` table (keys stored in
`scopePrefix` form; transactional upserts because the DB is cross-tab
shared) records `last_accessed` / `last_synced` per scope — the anchor for
future eviction controls and multi-dir replication (one merged engine taking
a scope set, per prior discussion).

Indexes currently declared (`schema.ts`):

- `logs`: `++id`, `&file_path`, `mtime`, `task`, `task_id`, `depth`,
  `cached_at`, `[depth+file_path]`
- `sample_summaries`: `[file_path+id+epoch]` (PK), `file_path`,
  `summary.completed_at`

Caveat to inherit: **out-of-namespace scopes degrade to cache-only** —
`namesInScope()` in `log_data/logsContent.ts` skips listing persistence when
listing names don't live under the scope prefix. The degrade is now an
explicit, session-sticky scope property (`isCacheOnlyListingScope`) driving
`logsListingSource`, which reads listings from the react-query cache for
such scopes (and db-less sessions) instead of the database. Single-file
mode never mounts the log list, so it needs no listing path at all.

### FindBand consolidation (#415)

`FindBandUI` (the presentational band: input, match counter, next/prev) is
now separate from its backing, shared in `packages/react/src/components/`.
The log list uses `FindBandUI` directly with a data-level backing, and the
swap this seam existed for has happened: match *membership* comes from the
DB-level `readLogsListingMatches` (via `useLogsListingMatches`, same
universe/filter/sort as the row query), with `buildSearchIndex` /
`findMatches` (`apps/inspect/src/app/shared/data-grid/findMatches.ts`)
remaining only for the small overlay rows (folders/pending). The match
*count* and the "no results" claim are universe-wide (out-of-window
matches count; because pages load head-first, the loaded matches are a
listing-order prefix of the universe's). What's left for step 5 is
display *ordering*: matches are ordered by the rendered rows, so matches
beyond the loaded pages aren't navigable until ordering moves to the
snapshot key list — a jump-to-offset consumer of the range-driven rework.

### The in-memory engine (now the plan compiler + overlay/samples path)

`apps/inspect/src/app/log-list/listing/`:

- `applyListingQuery.ts` — filter → sort → paginate over in-memory rows.
  Serves the samples listing and the pending-task overlay; `mergeSortedRows`
  (same file) merges the overlay into a db-produced page.
- `planner.ts` — compiles `(filter, orderBy, pagination)` + column accessors
  into a `DatabaseListingPlan` (`matches`/`compare`/`pagination`);
  `readLogsListing` executes it over the scan. No position tiebreak:
  executors sort stably over the scan's listing order (mtime-descending).
- `evaluator.ts` — full `Condition` interpreter (all 16 operators, SQL
  three-valued NULL semantics, LIKE→regex). The plan's `matches`, and later
  the residual predicate once index-backed scans land.
- `useLogsListingQuery.ts` — `useDatabaseLogsListingQuery` is the paged
  query hook: a `useInfiniteQuery` (queryKey = universe + accessor schema
  + filter + orderBy; the cursor is the page param, not a key slot) whose
  queryFn is `readLogsListingPage`, flattening the page window through a
  stable `select` and returning `{ result, hasNextPage, fetchNextPage }`.
  Results are async by design, with same-universe placeholders. The
  accessor-schema slot (`accessorsKey` from `useLogListColumns`) exists
  because the queryFn closes over the column accessors, whose score-column
  semantics (by-metric accessors, numeric comparators/filter types) land
  asynchronously with the scorer schema — without it a persisted
  score-column filter/sort computes against missing accessors and never
  self-corrects. The in-memory `useLogsListingQuery` remains for samples.
  `sortingStateToOrderBy` lives here.
- `combineFilters.ts` — AND-combines persisted per-column `FilterSpec`s into
  one wire `Condition` via the shared `specToCondition`
  (`packages/inspect-components/src/columnFilter/`).

Consumers: `grid/useLogListData.ts` (tasks/logs; splits pinned folders from
files, runs the listing query over files only, and threads
`hasMoreRows`/`fetchMoreRows` through to the grid) and
`shared/samples-grid/SamplesGrid.tsx` (cross-log samples). Both feed the
shared `DataGrid` (`app/shared/data-grid/DataGrid.tsx`) — TanStack Table +
react-virtual. The grid now has the infinite-load mechanism
(`hasMore`/`onScrollNearEnd`/`fetchThreshold`, scout's `checkScrollNearEnd`
checked on scroll and whenever a page lands); the logs list drives it,
while `SamplesGrid` still passes the complete array.

### Scout's reference implementation

`apps/scout/src/app/server/useServerTranscriptsInfinite.ts`: filter/orderBy/
pageSize in the query key (plus `"transcripts-inv"` sentinels for SSE topic
invalidation), `initialPageParam: undefined`,
`getNextPageParam: (last) => last.next_cursor ?? undefined`,
`placeholderData: keepPreviousData`, `fetchNextPage({ cancelRefetch:
false })` from a scroll-near-end trigger (`checkScrollNearEnd`, threshold
2000px, pageSize 500 — rationale comments in
`apps/scout/src/app/transcripts/constants.ts`). `total_count` returns on
every page; the UI reads `pages[0].total_count`. Server-side it's keyset
pagination with a forced `transcript_id ASC` tiebreaker and a separate
`COUNT(*)` per request — the parts we replace with the keys snapshot.

## Constraints that shape the implementation

**IndexedDB query reality.** One index per query; no index intersection; no
mixed-direction multi-column sort (compound indexes are single-direction;
`.reverse()` flips everything). `contains`/ILIKE filters — the majority —
are unindexable and run as JS `.filter()` predicates over the scan. Nulls,
undefined, and booleans are **absent from IndexedDB indexes**: iterating
`orderBy('mtime')` silently drops rows with no mtime, which the current JS
sort keeps — either union in a null-scan, store sentinels, or scan the
scope's PK range and sort in JS (fine under keys-first, since the scan
happens once per snapshot, not per page).

**Counts are O(n) no matter what.** `count()` is only index-fast on a pure
range; any residual predicate scans. This is *why* keys-first: the one scan
that orders also counts. The logs footer needs **two** counts
(`filteredCount / itemCount`) — the unfiltered one is a cheap scoped
`count()` on the `file_path` range.

**Dynamic score columns can't be index-backed.** `derived.scores` is a
nested map (`score_<scorer>/<metric>` column ids); you can't index a
wildcard path. Sorting/filtering on score columns is always residual — the
scan reads records anyway under keys-first, so this costs nothing extra.

**Retried marking forces the whole-scope scan.** `retried` is a cross-row
*derivation* (`computeLogsWithRetried` over the scan), not a stored column —
the one thing preventing an index-backed walk from producing the key list
without materializing every record. So the snapshot build starts as the
current scan, with transient O(scope) memory per rebuild (if that hurts at
target scale, a Dexie cursor (`each()`) retaining only `(key, sort values)`
tuples bounds it). The endgame is persisting `retried` at write time (a
`DERIVE_VERSION`-style bump wipes/recomputes stored rows), after which the
planner's full form (index choice + residual predicate, step 1) can build
snapshots without full materialization. None of this changes the two-tier
shape — only tier 1's queryFn internals evolve: scan → streaming cursor →
index-backed walk.

**Sample scans join the logs table.** Filters on task/model/status/created
in `/samples` refer to log-level context that is deliberately not
denormalized. The scan prefetches the scope's log rows (small — one per
log; `readLogRows` exists) into a map and joins in the residual predicate,
mirroring what `samplesListing.ts` already does at read time.

**A column-id → record-field mapping is a new artifact.** The planner needs
to know that column `completedAt` reads `completed_at`, `totalTokens` reads
`derived.total_tokens`, `score_grader/accuracy` reads
`derived.scores.grader.accuracy`, etc., per page. Today `getValue` accessors
live beside React column defs; the queryFn can't depend on those. Extract
the mapping (and each column's `FilterType` for coercion) into plain data
the service layer can own; column defs consume it rather than restating it.

**Invalidation churn during replication.** The sink writes continuously
during a cold sync, and invalidating an infinite query refetches **every
loaded page**. Debounce/coalesce invalidation per scope (adopt scout's
`-inv` key-sentinel convention with a prefix-match predicate: invalidate
listing queries whose scope contains the written file_path). The
refetch-every-loaded-page cost shrinks to refetch-observed-pages under the
range-driven rework. Snapshots make refetch cheap-ish (pages are bulkGets)
but the snapshot scan itself reruns per invalidation — coalescing matters,
and at true huge-dir scale consider backing the throttle off during sync
bursts (measure first).

**Stable tiebreakers.** Every orderBy gets a forced final tiebreaker so
order is total: `file_path` for logs, `[file_path, id, epoch]` for samples
(scout forces `transcript_id ASC` the same way).

**Features that silently assume the full list in memory** — each needs an
explicit answer in phase 3:

- Cmd/F: swap the `buildSearchIndex`/`findMatches` backing behind
  `FindBandUI` for a DB scan (it can reuse the snapshot's key list).
  *Answered*: `readLogsListingMatches` returns universe-wide ids + snapshot
  offsets; Find loads the sequential window through an active match and
  scrolls when it arrives. The range-driven rework later turns that
  load-through into a bounded direct jump without changing the match
  contract.
- Sample prev/next navigation: `displayedSamples` in the store is fed from
  displayed rows; with paging, adjacency should come from the snapshot key
  list (it *is* the adjacency list — scout needed a dedicated
  `useAdjacentTranscriptIds` server query for this).
- Selected-row restore/scroll-to (`selectedRowId` in grid state): the row
  may not be in a loaded page — find its offset in the key list, fetch
  through that page.
- Samples progress bar (`completedTaskCount`/`totalTaskCount`) and
  `filteredSampleCount`: currently derived from fully-displayed rows via
  `onDisplayedRowsChange`; become the snapshot count + small scoped
  aggregate queries over the logs table.
- Folders in the logs list are presentation: kept eager and pinned, only
  file rows paginate; footer count stays `folders.length + total_count`.
  *Answered as written* (landed with step 4; the pending-task overlay
  merges into the loaded window the same way).

## Work breakdown

Where things stand (details in the Status header): step 1 is landed as the
plan compiler only — no index choice, blocked on persisting `retried`;
steps 2–4 are landed for the logs listing, with their samples halves and
step 3's scope-prefix invalidation outstanding; steps 5–7 are untouched.
Parity tests live in `log_data/logsListingRead.test.ts`.

1. **Query planner + record evaluation** (pure, heavily testable):
   `(scope, Condition, OrderBy[], columnFieldMap)` → index choice +
   direction + residual predicate (reusing `evaluator.ts` against records) +
   sort comparator for the non-index-sortable cases. Parity tests: same
   fixtures through `applyListingQuery` and the planner path must agree —
   this is the migration safety net (extend
   `app/log-list/listing/listing.test.ts` / `client/database/database.test.ts`).
2. **Snapshot listing service** on `DatabaseService`:
   `getLogsListing(scope, filter, orderBy, pagination)` and
   `getSamplesListing(...)` returning `{ items, total_count, next_cursor }`;
   snapshot = ordered PK list as a tier-1 query per decision 3 (keyed off
   `databaseLogsListingKey` + `"snapshot"`, pages composing through the
   query cache — see the decision's `fetchQuery` amendment), with the
   first page seeded from the build. Handle
   snapshot staleness (a key deleted between scan and `bulkGet` → drop the
   hole).
3. **Hook swap**: `useLogsListingQuery` becomes a real `useInfiniteQuery`
   mirroring scout's hook (filter/orderBy/scope in the key, skipToken
   support, `keepPreviousData`); a samples sibling replaces
   `useSamplesListing`'s one-big-page mode (its paged param scaffolding
   already exists). Db-less / out-of-namespace scopes fall back to the
   in-memory `applyListingQuery` inside the same queryFn — the hook
   contract doesn't change. Wire debounced scope-prefix invalidation from
   the sink.
4. **Grid + pages**: port scout's `checkScrollNearEnd` into inspect's
   `DataGrid`, `pages.flatMap(p => p.items)` in `useLogListData` /
   `SamplesGrid`, footer counts from `total_count` + scoped `count()`,
   folders eager. (`maxPages` was landed here and rescinded — see
   decision 3's amendment.)
5. **Long tail**: find-match navigation beyond loaded pages is landed in
   lossless sequential form (match offsets + load-through). Snapshot-based
   adjacent-sample nav, selected-row restore, and samples progress
   aggregates remain on the range-driven rework's bounded jump-to-offset.
6. **Cleanup**: `applyListingQuery` shrinks to the fallback path;
   `evaluator.ts` loses its "delete me" banner (it's now the residual
   predicate); revisit which indexes earn their keep (e.g. is
   `summary.completed_at` the default samples sort index or is the scan +
   JS sort fine at target scale — measure first).
7. **Mirror demotion** (the last full-list holder): the react-query logs
   collection (`logsKey(logDir)`) still mirrors every row — headers
   included as details land — via the db ⟹ cache invariant, so memory
   stays O(dir) no matter how the read path paginates. In db-backed
   sessions, slim the mirror to what its remaining consumers actually need
   (the identity tier), keeping the full mirror only where it *is* the row
   source (db-less and out-of-namespace cache-only scopes — full-in-memory
   is unavoidable and correct there). Audit consumers first:
   `resolveLogKey`, slice/routing reads (`getLogRows`), `useLogs`,
   single-file mode seeding, and the samples paths.

Phase 1→2 order matters less than it looks: 1 and 2 land invisible behind
parity tests; 3+4 flip the pages over; 5 can trail; 7 lands once nothing
on the paginated path reads the full mirror.

## Chunked listing ingestion (separate workstream, server-dependent)

The cold-load budget on a huge dir — the point-the-UI-at-a-big-S3-bucket
case — is dominated by the front of the pipe, not the read path: the view
server enumerates the whole listing and returns it in one shot,
`writeListing` lands it in one round, and no cold-scope rows render until
that round-trip completes (a warm replica renders instantly; the cost is
cold or heavily-changed scopes). Paging/streaming the listing response is
a view-server API change, so scope it early and independently of the
read-path phases above. Client-side consequences once it exists:
`writeListing` ingests chunks (and drops its whole-dir re-read-after-write,
itself O(dir) per sync round), sync diffing works per chunk, and the
existing throttled invalidation already streams partial results to the
grid as chunks land — no read-path changes required.

## Open questions for the implementer

- Page size / fetch threshold: start with scout's 500 / 2000px and measure.
- Whether any hot sort column deserves denormalization to a top-level
  indexed field later (e.g. `summary.completed_at` already is one) — only
  after measuring; keys-first makes most of this moot. (`retried` is the
  known exception — see the retried-marking constraint.)
- Scout reconciliation: `apps/scout/src/query/` still duplicates
  `packages/inspect-common/src/query/` (a noted follow-up, orthogonal to
  this work).
