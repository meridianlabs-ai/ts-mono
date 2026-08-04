# Logs pagination merge blockers

Current review target: `brandly/maybe-paginate` at `8ae89633`.

Status: both required items below are ADDRESSED —

- Blocker 1 landed as `8ae89633` (serialized dirty loop in
  `databaseListings.ts`; both required regression tests included and
  verified to fail against the prior implementation).
- Blocker 2 landed as `137e1e22` (static-changed listings reconcile and
  persist with a deleted/invalidated split; end-to-end regression test
  included).
- Merge verification results are recorded at the bottom of this document.

The sections below are retained as the specification the fixes were built
and reviewed against.

## Required before merge

### 1. Serialize listing invalidation and refetch

`apps/inspect/src/log_data/databaseListings.ts` currently invalidates with
`cancelRefetch: false`. When the final invalidation in an ingestion burst
overlaps an in-flight page fetch, TanStack Query can reuse the existing
promise and clear the invalidated state when that older fetch succeeds. With
no later write, the completed listing can remain stale indefinitely.

An epoch bump can also occur between pages of a retained-page refetch. Since
each page independently reads the current epoch, one committed result can
splice pages from two differently ordered snapshots, producing duplicate or
missing rows.

Implement one serialized dirty loop:

1. A listing write marks the listing family dirty.
2. If a listing request is active, wait for it to settle without cancelling
   it.
3. Clear the dirty marker, bump the snapshot epoch, and await one
   invalidation/refetch.
4. If another write marked the listing dirty while that refetch ran, repeat.
5. Exit only after a refetch completes with no newer dirty marker.

This must preserve the reason for `cancelRefetch: false`: an invalidation
must not cancel or demote an in-flight `fetchNextPage`.

Implementation cautions:

- A settled error also counts as "settled" for step 2, and the loop must not
  tight-retry a persistently failing refetch (the same hazard
  `autoFetchPaused` guards in the grid). Park the dirty marker on error and
  let the next write / manual retry resume the loop.
- `65e9ca18` made unchanged re-syncs skip the listing invalidation, so an
  errored row query no longer passively heals on poll ticks; recovery is
  the retry banner, real writes, or query-input changes. The dirty loop
  should either keep that policy deliberately or restore passive healing —
  decide explicitly rather than inheriting whichever falls out.

Required regression tests:

- Start `fetchNextPage` against snapshot A, mutate the backing rows to B,
  invalidate while the page is blocked, and release it. Assert that the page
  lands and an automatic catch-up refetch exposes B without another write,
  filter change, or manual invalidation.
- Delay a multi-page refetch, mutate ordering, and invalidate during the
  refetch. After the invalidation loop becomes idle, assert that every
  retained page represents one coherent ordering with no duplicate or
  missing rows.

### 2. Reconcile static/no-mtime listings

`apps/inspect/src/log_data/listingSync.ts` applies a changed static listing
with `persistListing: false`. The paginated listing now remains
database-backed, so the cache receives the new names while the UI can
continue reading stale IndexedDB rows.

It is worse than stale-db-rows alone: `applyListing`'s non-persist branch
calls `sink.setListing`, which fires no listing invalidation at all — so
even a scope whose reads ARE cache-sourced never refetches the listing
query after a static change. Pre-pagination the UI read the cache mirror
reactively; now every listing read goes through the dexie-listing query and
only moves on invalidation. Whichever remedy is chosen must also fire the
listing invalidation on this path.

If no-mtime transports remain supported, changed full responses must either:

- reconcile and persist the complete listing, including deletions; or
- explicitly make the scope cache-authoritative for the session.

Required regression test:

- Seed a static listing with `a,b`, synchronize a changed full response
  containing `b,c`, and assert that both the authoritative listing read and
  IndexedDB contain only `b,c` — and that the listing queries were
  invalidated (the UI refreshes without a manual retry or unrelated write).

If no-mtime transports are intentionally unsupported, remove or reject this
path explicitly instead of retaining behavior that appears supported but
serves stale data.

## Merge verification

After the fixes:

1. Run the full Inspect test suite.
2. Run the `apps/inspect` and `packages/react` typechecks.
3. Against the 50k dataset, load at least two pages, allow ingestion to
   become idle, and verify the final count and ordering with no duplicate
   rows.
4. Against a live eval (writes flowing), verify a running log's status and
   score columns still update within a few seconds — both fixes reduce
   invalidation frequency, so freshness needs an explicit check, not just
   correctness.
5. Sanity-check an ordinary small dir (hundreds of logs): listing loads,
   updates on new files, and deletes disappear — the diff/serialization
   changes must not regress the common case.

## Verification results (2026-07-28, at `8ae89633`)

1. Full workspace test suite: 9 turbo tasks green; apps/inspect 1102/1102.
2. Typechecks: `apps/inspect` and `packages/react` both clean (`tsc
   --noEmit`).
3. 50k dataset (production build served standalone, cold IndexedDB):
   scrolled to 6 pages / 3,000 rows of a 48,750-row universe — all row
   keys distinct, zero mtime-ordering violations across page boundaries,
   ingestion reached quiet, and pagination remained live afterwards.
4. Freshness: a file added to the dir surfaced with no interaction in 15s
   (count 48,750 → 48,751, new row rendered at the top).
5. Small-dir sanity: the dev viewer serving an ordinary dir (2 files +
   folders) loads, reaches quiet, and reports a coherent count.

## Explicitly deferred follow-ups

These are important but do not block this merge:

- Fix the schema-arrival window collapse: the score-column schema landing
  (~2s after a cold load) changes `accessorsKey`, which changes the listing
  query key — a scrolled window resets to page 1 and the scroll position
  clamps. Self-heals on re-scroll, but it is the most user-visible papercut
  at scale.
- Compare `size` in the sync diff and `invalidated`: the server re-sends
  same-mtime boundary files precisely so the client can size-detect
  same-second rewrites, but the client never has (pre-existing). Needs the
  generated `LogHandle` type regenerated to carry `size`, plus `writeLogs`'
  merge and `toHandles` retaining it.
- Replace sequential infinite-query accumulation with virtualizer-driven,
  offset-addressed page queries.
- Bound Find and page memory; avoid loading every preceding page for a deep
  jump.
- Restore selections whose rows are not already loaded.
- Correct pending-task overlay positioning against the full result
  universe.
- Eliminate repeated full-scope scans and the unchanged-poll full database
  read.
- Surface column-facts failures and retain coherent aggregates during
  retried-toggle transitions.
- Add per-file generations for already-claimed preview/detail work.
- Build the compact sample catalog, sample pagination, and windowed message
  loading described in the broader scalability plan.
