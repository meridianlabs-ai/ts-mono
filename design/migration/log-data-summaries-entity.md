# Summaries as an entity store (entity-model goal, phase 2)

Design note for phase 2 of `log-data-entity-model-goal.md`: `SampleSummary`
becomes its own Dexie table and read model; `log_details` stops carrying the
embedded blob. Read the goal doc first — this note only records the decisions
that needed making.

## Store model (Dexie v11, recreate-on-mismatch)

- **`sample_summaries`** — one row per sample summary:
  `{ file_path, id, epoch, summary: SampleSummary, cached_at }`, PK
  `[file_path+id+epoch]`, indexes `file_path` (scope reads) and
  `summary.completed_at` (default sort). Populated only by the sink at
  details-ingestion time.
- **`log_details`** — now stores the **header only**: the details payload
  minus `sampleSummaries`, plus three write-time derived facts (below). Same
  table name until phase 3 merges it into the unified `logs` row.

## Types

- `LogDetails` (client/api) stays exactly what the wire delivers — transport,
  acquisition-internal.
- **`LogHeader`** = `Omit<LogDetails, "sampleSummaries">` plus derived facts:
  `sampleCount`, `sampleErrorCount`, `sampleLimits: string[]` (distinct,
  sorted). This is the stored row shape AND the cache value under the detail
  keys — `useLogDetail`'s `T` shrinks to it now (the goal's phase-3 note said
  "toward header-only"; the split forces it here). Conversion
  (`toLogHeader`) lives next to `toLogPreview`.
- Derived facts are computed at ingestion because they are listing columns
  (Sample Errors / Sample Limits / the zero-samples default-tab check) —
  putting them on the header removes every whole-dir summaries scan from the
  listing path. They are attributes of the Log entity, recomputed on each
  ingestion of that log (mid-run appends included). `JsonTab` strips them the
  same way it stripped `sampleSummaries`.

## Sink split (the one write path)

`writeDetails`/`writeDetail` (logsContent seam) take transport payloads and,
per log, in **one Dexie transaction**: put the header row, delete the file's
old summary rows, bulkPut the new ones. Then, outside the transaction:

1. merge headers into the cache (whole-dir map — now subsystem-private — and
   the guarded per-handle detail pushes, unchanged mechanics);
2. **push** fresh rows into any *observed* file-scope summaries query for the
   file (`setQueryData`, same observed-only guard as `pushDetail`) — this is
   what keeps the log view's running→complete handoff atomic (see
   live-append);
3. **invalidate** the whole `["log_data", "samples", logDir]` family —
   dir/subtree-scope queries refetch from Dexie; `keepPreviousData` covers
   the gap.

`merge*` (cache-only seeds: engine start(), read-through cache hits) now
carry `LogHeader` values — the stored form. `write*` carry payloads. The
engine keeps fetching `LogDetails` and never learns about the split.
`clearFile`/`clearAll` clear the new table and invalidate the family.

**db-less sessions** (single-file / VS Code embed: `database: null`): writes
are cache-only, so step 2's file-scope push is the *only* place settled
summaries land — it must push unconditionally-if-observed, not rely on
invalidation (there is no Dexie to refetch from). Dir-scope reads return
empty there, which matches today (no listing).

## Engine changes (minimal)

- `fetch()` becomes `Promise<void>`: no caller reads the resolved payload
  (verified — all call sites are fire-and-forget or await-for-settle), and
  the cache-hit path can no longer produce a full `LogDetails` without
  re-parsing every summary row — which the goal forbids on the read path.
- The read-through cache hit reads the header row, seeds the cache via
  `mergeDetails` (headers), resolves. `findMissingDetails` reads
  `details.status` off the header row — unchanged.

## Read model

- **`useSamplesListing(params)`** (new, exported): the scoped read.
  `params = { logDir, scope, filter?, orderBy?, cursor?, limit? }` where
  `scope` is `{ file }` or `{ prefix }`. Returns rows of
  `{ logFile, summary, log: { created?, task?, model?, status? } }` — the
  log context is joined in the queryFn (headers for the distinct files in
  scope) so consumers never join by name. Paged queryFn shape from day one
  (`{ items, nextCursor }` internally); phase-2 consumers read one big page.
  `filter`/`orderBy`/`limit` sit in the query key now, implemented minimally
  (undefined = everything, natural order) — flipping to `useInfiniteQuery`
  later is a queryFn swap, not a contract change. Db-backed queryFn,
  invalidation-driven, `keepPreviousData`, default gcTime (GC-able like
  `useLogDetail` entries).
- **`useSampleSummaries(logDir, logFile)`** keeps its contract (the log
  view's live list): file-scope `useSamplesListing` merged with the
  pending-buffer samples, assembly private. Its non-React snapshot
  `getSampleSummaries` becomes **async** (Dexie read + pending merge) — its
  only callers (`runningSampleQuery`'s finalize/tick helpers) are already
  async. `hasCompletedLogSummary` reads settled rows the same way (no
  pending merge, as today).
- **`useScoreSchema(logDir, scopePrefix?)`** (new, exported): the scorer/
  metric column discovery — `computeScorerMap` over the (header-only,
  subsystem-private) whole-dir map, content-stabilized inside
  (`scorerMapsEqual`). Consumers get a stable `ScorerMap` and stop touching
  details.
- **`useLogListing` rows gain `header?: LogHeader`** — the grid's per-row
  details read (samples counts, duration, task args, scorer values,
  sample-facts columns) moves onto the row; the whole-dir join and the
  `useDeferredValue` damping stay inside `log_data`. `useLogDetails` leaves
  the barrel (no `app/` consumers remain).

## Live-append (the hard spot)

Running log open: `usePendingSamples` polls the buffer; each OK tick
fire-and-forgets an elevated engine details fetch; `NotFound` (buffer gone)
awaits it. Every details settle runs the sink split above. The log view's
sample list is `settled ⊕ pending`:

- **Mid-run append**: new summaries land in Dexie + are pushed into the
  observed file-scope query synchronously with the header cache push — same
  render sees consistent status + rows, as today.
- **running→complete finalize**: the status flip (header push) disables the
  pending poll and drops buffered rows in the same update that the pushed
  settled rows arrive in — no window where a sample that existed only in the
  pending buffer vanishes. This is why file-scope is push-not-invalidate:
  invalidate-then-refetch would open exactly that flash window. The
  running-log test locks this in.
- **Samples mode** (dir scope): appends arrive via invalidation → Dexie
  refetch with `keepPreviousData` (running logs' rows tick in as their
  details settle, driven by listing sync / the open log's poll, as today).
  One invalidation sweep per batched flush (250 ms), so backfill storms cost
  one Dexie scan per flush per active query — bounded, and off the render
  path (today the same storm rebuilds every row from the whole-dir map in
  render).

## Consumer moves (all compile-time forced by `LogHeader`)

- `SamplesPanel`: rows from `useSamplesListing({ prefix })`; retried
  filtering keeps using its listing rows (user-toggle concern, not an
  acquisition join); `optionalHasData` computed over the returned rows;
  `buildSampleColumns` raw-mode discovery takes `samples: SampleSummary[]`
  instead of a details map.
- `LogListGrid` / `columns/hooks`: header columns + sample-facts columns off
  `row.header`; scorer columns from `useScoreSchema`; `hasSampleLimits` from
  listing rows.
- `LogLoadController`: zero-samples default-tab check reads
  `header.sampleCount` (atomic with the settle it keys off).
- `SampleFilter` autocomplete: `useSelectedSampleSummaries()` (was a direct
  embedded read that skipped the pending merge — now consistent with the
  list it filters).
- `DatabaseService`: summaries readers move to the table;
  `querySampleSummaries`/`readAllSampleSummaries` deleted if unconsumed;
  stats count the table.

## Test-first

The running-log test (before implementation): drive the sink with a
started-status payload, append (second payload, more summaries), then
finalize (success payload) — assert the file-scope read reflects each step,
never empties between settles, and pending-merged assembly drops buffer rows
only when their settled forms are present. Plus: split writes are atomic
(header row and summary rows agree after each ingestion), invalidation
reaches prefix-scope queries, db-less push path serves the file scope.
