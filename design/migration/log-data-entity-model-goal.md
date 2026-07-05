# Goal: entity read model — logs & sample summaries as entities; tiers as acquisition policy only

## Intent (north star)

The log-data read model is organized around the domain's **two entities**,
not around wire payloads:

- **Log** — identity (logDir, name) + header attributes (status, task,
  model, timestamps, results, error, config…), acquired at **progressive
  depth**: `listed` (dir stat: name + mtime) → `previewed` (zip crack, small
  JSON) → `detailed` (zip crack, large JSON). Depth is a *column on the
  row*, never a different type or a different store.
- **SampleSummary** — identity (file, id, epoch) + row attributes; belongs
  to a Log. (`EvalSample` remains the on-demand deep form of a sample —
  unchanged by this goal.)

**The motivating principle — everything else in this doc serves it: the
acquisition tiering must not leak upward.** The tiers exist because of
fetch physics (a dir stat is cheap; a preview cracks the log zip for a
small JSON; summaries crack it for a large one) — they are *how the engine
schedules work*, and they must remain fully intact there. But today the
tiers leak all the way up the stack: `LogPreview` and `LogDetails` are
**transport shapes**, not entities (a preview is a cheap projection of a
Log; a details response is a deeper projection of the same Log *bundled
with rows of a different entity* — its sample summaries), yet those payload
shapes name our cache keys, Dexie tables, and public hooks, and force
panels to hand-join handles ⋈ previews ⋈ details by name. Every consumer
has to know which endpoint its data rode in on. That leakage — not naming,
not tidiness — is what this goal removes. The test for every design
decision here: *could a panel author, seeing only the public surface, tell
that previews and details are fetched separately?* If yes, the tier has
leaked. The goal: **normalize at the sink, denormalize in queries.** The engine keeps fetching whatever the endpoints
give it (that's acquisition); the sink splits payloads into entity stores at
write time; consumers ask domain questions and never learn which endpoint
the answer rode in on. Dexie is the entity store; react-query is the
subscription layer over it (db-backed queryFns, invalidation-driven,
GC-able — the pattern `useLogDetail` already established).

**Tiered acquisition is retained in full** — it is load-bearing for UX
(instant listing from mtimes, preview waves for the first screenful,
background summary backfill, user-priority bump on open). The tiers survive
as *scheduler policy* (the unified priority queue, batching, first-wave,
passive/active demand — all already built) and die as *public vocabulary*.

Success is measured by reduction: panels consume one listing hook instead
of three collections plus a by-name join ritual; `useLogPreviews` /
`useLogDetails` leave the public surface the way `useLogHandles` already
did; whole-dir `Record` aggregation in `SamplesPanel`/`columns/hooks`
dies; opening a 200k-sample log stops parsing every summary on the read
path.

Read first: `design/migration/log-data-unified-fetch-plan.md` (data-model
tables + what the unified-fetch work landed), `domain-ownership.md`,
`apps/inspect/src/log_data/index.ts` (ubiquitous-language header — this
goal *changes* that language; update it as terms shift).

## Scope

IN (phased below):

- **`useLogListing(logDir): LogListingRow[]`** — the one listing read:
  `LogListingRow = LogHandleWithRetried & { preview?: LogPreview }` (shape
  may flatten when the unified row lands; `preview` optional because it
  genuinely lags the handle — the tiering expressed as one nullable field).
  Retried-dedup stays inside; the `useDeferredValue` flush-burst damping
  moves inside; `LogsPanel`/`SamplesPanel` drop `useLogHandlesWithRetried` +
  `useLogPreviews`; `useLogPreviews` and `useLogHandlesWithRetried` leave
  the barrel (subsystem-private).
- **`sample_summaries` as its own Dexie table**, keyed `[file+id+epoch]`
  with sort/filter indexes, populated by the sink at details-ingestion time
  (one details payload ⇒ header write + N summary-row writes, one
  transaction). Reads move to a scoped summaries hook — one key family
  serves both the log view's samples ("scope = one file") and samples mode
  ("scope = dir/subtree") — replacing `SamplesPanel`'s whole-dir
  `useLogDetails` aggregation and `sampleSummaries.ts`'s per-log read.
  Cursor/paged `queryFn` shape from the start (scout's
  `useServerTranscriptsInfinite` is the reference), even if phase-2
  consumers initially read one big page.
- **Scorer/column discovery becomes a subsystem query** (e.g.
  `useScoreSchema(logDir, scope)`) over the entity store, replacing
  `computeScorerMap`-over-`useLogDetails` in
  `app/log-list/grid/columns/hooks.tsx` and the details map read in
  `LogListGrid.tsx`.
- **Unified Log row**: merge `log_previews` + the header half of
  `log_details` into one `logs` entity table — identity + header +
  `depth: "listed" | "previewed" | "detailed"` + the fetch-state columns
  folded in (retrieval error/attempts/settled-seq are just more facts about
  the row). mtime invalidation resets depth (row keeps identity, drops
  content). Per-entity key `["log_data", "log", logDir, name]` generalizes
  today's detail key; `useLogDetail`'s `LogDataState` contract is already
  final — its `T` shrinks toward header-only. `DB_VERSION` bumps
  recreate-on-mismatch (cold cache, ledger entry — same as v10).
- **Demand hints, not concepts**: hooks state what they need
  (`depth`, active/passive — passive/active already exists); the engine
  translates to endpoint choice, batching, priority. Engine/queue
  mechanics (preview wave 24/batch, first-screenful High, backfill gating,
  fresh-flag semantics) unchanged except where the sink split requires
  plumbing.
- Ubiquitous-language header in `log_data/index.ts` and
  `domain-ownership.md`/plan data-model tables updated as vocabulary
  shifts (Log depth, listing row, summaries scope; `LogPreview`/`LogDetails`
  demoted to acquisition-internal transport names).

OUT (future goals):

- **Infinite/paged listing UI** (`useInfiniteQuery` pages + grid virtualizer
  wiring + server-side filter/sort) — this goal builds the queryFn-ready
  read model; flipping the listing to pages is the next goal.
- **Server-side splits** — header-only `get_log_details`, a paged summaries
  endpoint, per-file results for `/log-headers`. This goal must not
  *require* them; when they land they're invisible acquisition upgrades.
- `EvalSample` acquisition/shape; listing UI affordances for fetch errors
  (recorded but still omitted from rows); scout reconciliation.

## Done when (all must hold)

- Root `pnpm typecheck`, `pnpm lint`, `pnpm test` green (turbo, ts-mono
  root); behavior-change ledger
  (`design/migration/loglistgrid-tanstack.md`, unified-fetch section)
  updated per phase.
- Structural invariants (greppable, scoped to `apps/inspect/src`):
  - `useLogPreviews`, `useLogDetails`, `useLogHandlesWithRetried` are not
    exported from `log_data/index.ts` and have zero consumers outside
    `log_data/`.
  - `.sampleSummaries` (the embedded array) is read **only inside
    `log_data/`** (sink/ingestion + queries); no `app/` or `state/` module
    touches it.
  - `rg "useLogListing" apps/inspect/src/app` hits `LogsPanel`,
    `SamplesPanel` (and any listing surface), and nothing hand-joins
    handles to previews by name anywhere.
  - One Dexie write path per store (the `logsContent` seam); the engine
    remains framework-free; `rg "get_log_details|get_log_summaries"`
    production call sites unchanged (client-api + engine only).
  - Scorer columns derive from the subsystem query, not from a details map
    in `app/`.
- **Leakage audit** (the motivating principle, judged not grepped): no
  module outside `log_data/` decides *when or whether* a tier is fetched,
  branches on which payload carried a fact, or could reveal to its reader
  that previews and details are separate fetches. Depth may be *read* off a
  row and *requested* as a demand hint — never dispatched on as a type.
- Tiered-UX parity, verified against a live dir (the branch's two-viewer
  setup): listing rows appear from the dir stat before previews land;
  preview first-wave still front-runs summary backfill (cold-dir test);
  opening a large log renders its samples without reading all summaries
  into the render path.
- Live/running parity: a running log's samples still tick in (summary
  appends reach the summaries store and its subscribers), and
  running→complete finalize still hands off without a loading flash.

## Decision rubric (decide yourself — see Autonomy)

- **Entities over payloads**: if a name in a public surface matches a wire
  response rather than a domain noun, it's wrong. Transport names live in
  `client/` and the sink.
- **Answers over mechanisms**: a consumer combining two log_data hooks to
  answer one question means the surface is wrong — compose inside. Don't
  pre-compose what nobody asks.
- **Depth is data, demand is a hint**: consumers may *read* depth off a row
  and *request* depth via options; they may never branch on "preview vs
  details" as types.
- **Normalize at the sink**: any payload→store fan-out happens exactly once,
  in the seam; queries denormalize. No consumer-side joins by name.
- **Tiers are sacred in the scheduler**: any change that makes cold-dir
  first paint worse than current branch behavior is a defect, not a
  trade-off (cf. the F1 cold-start finding in the unified-fetch review —
  don't reintroduce it).
- **Paged-shape from day one**: new queryFns take (scope, filter/sort,
  cursor) even while consumers pass "everything" — the pagination goal must
  be a queryFn swap, not a contract change.
- **Params over ambient; passive reads stay passive; delete don't relocate;
  no compat shims; comments say WHY; no `any`/assertions in src.**

## Suggested phasing (adjust as discovered; each phase green + committed)

1. **`useLogListing`** — merged rows, deferral internal; panels swap;
   `useLogPreviews`/`useLogHandlesWithRetried` off the barrel. Pure
   read-side; no schema change. (Deletes: the panel join ritual.)
2. **Summaries table + scoped summaries hook** — sink splits details
   payloads; `DB_VERSION` bump; samples mode + log samples tab consume the
   scoped hook; `useScoreSchema` replaces `computeScorerMap`-over-map;
   whole-dir `useLogDetails` consumers in `app/` end here. **The hard spot
   is live-append**: running logs deliver summary updates via the
   details/poll path today — design the store-update + invalidation flow
   (scout's invalidate + `keepPreviousData` is the reference) *before*
   coding; write the running-log test first. (Deletes: whole-dir details
   aggregation.)
3. **Unified Log row + depth** — previews/details-header merge; fetch-state
   columns fold in; per-entity log key; engine ensure becomes depth-aware
   (`ensure(name, { depth, demand })`); `useLogDetail` → `useLog` (contract
   unchanged, `T` shrinks). (Deletes: preview-vs-details as store/cache
   concepts.)
4. **Docs sweep** — barrel language header, `domain-ownership.md`, plan
   data-model tables, ledger.

## Guardrails (must not break)

- Behavior parity per Done-when; note timing shifts in the ledger. The
  intentional-behavior-change ledger discipline continues.
- Commit in the **ts-mono submodule**; parent repo gets gitlink bumps only.
  **Always ask before pushing.** Commit per phase; never commit red.
- Don't disable static-analysis warnings without discussing.
- Matt Brandly is doing UI fixes on this branch — phases 1–2 touch
  `LogsPanel`/`SamplesPanel`/`LogListGrid`/`columns/hooks`; check
  `git status` for concurrent edits before sweeping those files and keep
  those diffs tight.

## Autonomy contract (HIGH)

- Proceed without asking on anything the rubric covers — module placement,
  row-shape details, index choices, test relocation, phase sequencing.
- Surface only: (a) a genuine fork the rubric doesn't resolve (the phase-2
  live-append design is the likely candidate — write the design note, then
  proceed unless it forces an OUT-list item), (b) a real parity/perf risk,
  (c) scope creep into OUT, (d) before pushing.

## Current state (branch `loglist-tanstack-phase1`, ts-mono submodule)

- Precedent landed (unified-fetch work, commits `76d051bd..570fe436`): one
  prioritized fetch queue (previews+details, per-item retry, cross-kind
  coalesce, passive/active demand); per-handle fetch-state store
  (`log_fetch_state`, Dexie v10) with attempts-gated backfill; per-handle
  db-backed detail entries (`["log_data","detail",logDir,name]`,
  `LogDataState`, GC + Dexie re-seed) — the sink/entity-store pattern this
  goal generalizes. `useLogDetailQuery` absorbed; `LogLoadController` keys
  off `details_settled_seq`.
- Listing reads today: `useLogHandlesWithRetried(logDir)`
  (`log_data/logListing.ts`, handles ⋈ previews, dedup) + panels separately
  reading `useLogPreviews` (row content, by-name join) + `LogListGrid`/
  `columns/hooks.tsx`/`SamplesPanel` reading whole-dir `useLogDetails`
  (scorer columns; samples-mode aggregation over embedded
  `sampleSummaries`). `useLogHandles` is already subsystem-private.
- Dexie stores: `logs` (handles), `log_previews`, `log_details` (header +
  embedded `sampleSummaries` — the blob this goal splits),
  `log_fetch_state`. Schema/key inventory tables:
  `log-data-unified-fetch-plan.md` "Data model".
- Physical costs anchoring the tiers: dir listing with mtimes is cheap;
  a preview = crack the log zip + read a small JSON; details = crack the
  zip + read the large summaries JSON. The scheduler already encodes this
  (preview wave High/24-batch before backfill; summaries at Low/user-bump).
- Known open questions parked with this goal's area: fetch-state
  `useLogFetchState` full-table scan per mount (fold into the unified row);
  `log_fetch_state` row accretion from persisted settled-seq; cold-dir
  preview *tail* pacing (ledger note in `loglistgrid-tanstack.md`).
