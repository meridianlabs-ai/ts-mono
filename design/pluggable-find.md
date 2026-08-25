# Pluggable Find

**Status:** Draft for review — interfaces are the thing to pressure-test
**Date:** 2026-08-24
**Prior work:** "Inspect Viewer Find — Proposal & Research" (cmd+f redesign research);
this doc builds on its conclusions and pins down the interfaces and layering.

## Problem

cmd+f find is built on `window.find()` — a non-standard API that searches the
rendered DOM. Virtualized rendering broke it (only visible rows exist in the
DOM), and the compensating machinery (`findExtendedInDOM`'s 25-attempt retry
loop, 2s DOM polling, selection save/restore, the 300ms post-Prism reselect
timer, `SKIP_LIMIT` skipping) is fragile and unfixable in place. Three forces
make replacement urgent:

1. **Massive transcripts.** We are moving toward samples that never fit in
   memory (10B-token transcripts, windowed data loading). A find engine that
   requires the full data client-side — let alone in the DOM — has no future.
2. **Pluggability.** hawk (METR's Postgres warehouse of Inspect logs) embeds
   the viewer in-process and wants to drive find from its database. Today
   find has no backend seam at all.
3. **The log list is paginating.** Its cmd+f must keep matching rows beyond
   the loaded page. (Its current implementation already does this right —
   see "Prior art in-repo" below.)

Out of scope: the Scout-backed SearchPanel and its `Result`/`References`
contract. That shape is driven by how Scout scanners work and stays exactly
as it is. Find is a **separate, deliberately smaller contract**; hawk will
implement both.

## Decisions (settled in discussion)

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Keep the browser-find UX grammar exactly: incremental count while typing, N of M, Enter/Shift+Enter with wrap, F3 / Cmd+G, Esc. Only the engine changes. | Hijacking cmd+f is justified only if the replacement is a faithful find. |
| D2 | Search a data model, never the DOM. Matches are anchors (event uuid / message id / row id) + occurrence index, held in a store; rows self-highlight from props. | The convergent pattern (VS Code, xterm.js, CodeMirror); root-cause fix for the retry/poll machinery. |
| D3 | v1 query semantics: **case-insensitive literal substring**, nothing else. | Exactly what cmd+f does today (`findConfig` hardcodes it), so zero UX regression; every added feature is one more thing three implementations must agree on. Regex/word-boundary arrive later as declared capabilities (hawk's `transcript_grep` already supports both). |
| D4 | Searchable universe = **the active surface's navigable universe under current view configuration** (see "Scope semantics"). | Matches current transcript behavior (`searchableEvents`: hidden types removed, unscoped by trajectory selection) and log-list behavior (matches under the same universe + filter + sort as the rows). |
| D5 | View config in the query is limited to the **excluded-event-types list** for v1. | Cheap and declarative everywhere (`WHERE event NOT IN (...)` for hawk); richer scoping waits until a surface needs it. |
| D6 | Match order = chronological event order across all subagent trajectories (current behavior). | Matches the timeline mental model; deterministic; server-friendly (`ORDER BY event_index`). |
| D7 | Counts are `{value, relation: "eq" \| "gte"}`; match lists are **cursors/windows, never materialized by contract**. | 10B-token transcripts make materialized lists impossible; "10,000+" becomes first-class instead of a hack. |
| D8 | Navigation is delegated to an anchor-reveal primitive the data layer must grow anyway for deep links (`?event=` / `?message=` must resolve regardless of what's in memory). | Find sources answer only "which anchors match, in what order" — they never know about scroll or view state. |
| D9 | The searchable-text projection is a **shared definition, not shared code**: rendered-form text per node, pinned by conformance fixtures that both the TS extractors and hawk's SQL columns run against. | hawk searches its own text columns; without fixtures the definitions drift (hawk already needed a re-anchoring hack when its text included unrendered fields). |
| D10 | Within an anchor, the **browser's re-find over rendered content is authoritative** for stepping and highlighting; server per-anchor counts are estimates. A jump is never silent — if nothing highlights, scroll there and flash the anchor. | Highlights can never disagree with the screen; third-party sources stay safe to trust even when their text rules drift. |
| D11 | The `prepareSearchTerm` variant matching (quoted / JSON-escaped forms) is **not ported into the contract**. The projection spec emits rendered-form (unescaped) text, which removes the need. | The variants compensate for JSON-escaped projections; "OR of three ILIKE patterns with overlap dedup" is unspecifiable across implementations. The raw-JSON tab keeps its own projection where escaped text is genuinely what's on screen. |
| D12 | Injection for embedders goes through **optional members on `LogViewAPI`** (the seam hawk already implements via `setApiFactory`), adapted into a `FindSource` by the inspect app. | One seam, one capability-detection idiom (member undefined → fallback), no new mounting concept. The `FindSource` interface itself lives in a shared package so scout wires the same coordinator without depending on the inspect app. |

## Prior art in-repo

Two existing pieces already embody the target architecture:

- **`LogListGrid` find** (`apps/inspect/src/app/log-list/grid/`): no
  `window.find` at all. `useLogsListingMatches` computes match membership as
  a data-level query against the listing source "under the same universe +
  filter + sort as the rows" — explicitly designed to keep working under
  pagination. Active match drives `selectedRowId`; the grid scrolls it into
  view. A local overlay index handles rows with no listing record (folders,
  pending) and merges in. This is the pattern, already shipping.
- **`useTranscriptSearchSource`** counting: `findAllMatches` over
  `extractEventFields` text already produces the anchor + occurrence match
  model (`SampleMatch { eventId, fieldKey, fieldIndex, occurrenceIndex }`)
  independent of rendering. What's replaced is everything downstream of the
  count: the `window.find` handoff, cursor pre-positioning, selection
  listener, skip limits, reselect timers.

## Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│ Shared packages (@tsmono/react + inspect-components)               │
│                                                                    │
│  FindBand UI ──▶ Find coordinator (store: query, match window,     │
│                  activeIndex, total, completeness)                 │
│                        │                    ▲                      │
│                 reveal(match)         register(surface)            │
│                        ▼                    │                      │
│  Surfaces: transcript / messages / log list / json …               │
│    each registers { source, reveal } on mount                      │
│    rows self-highlight from context (TreeWalker → CSS Custom       │
│    Highlight API; <mark> fallback)                                 │
│                                                                    │
│  Default FindSource: in-memory/worker scan over the surface's      │
│  data via the shared extractors (eventText / messageSearchText)    │
└────────────────────────────────────────────────────────────────────┘
                             ▲ FindSource (shared interface)
          ┌──────────────────┼──────────────────────┐
          │                  │                      │
   default in-memory   view-server impl       hawk impl
   /worker source      (scans the .eval       (Postgres text
   (no backend)        where it lives)        columns, keyset SQL)
          ▲                  ▲                      ▲
          └──── inspect adapts optional LogViewAPI find members ────┘
                (member absent → default source; hawk supplies its
                 implementation through setApiFactory, as today)
```

Three layers:

1. **Shared packages own the view and the coordinator** — FindBand UI, the
   match store, navigation glue, per-row highlighting, and the default
   in-memory/worker source built on the extractors. (The coordinator
   replaces `ExtendedFindContext`, keeping its per-surface registration
   topology but registering data-level async sources instead of DOM pokers.)
2. **Each surface registers a source + reveal function when it mounts** —
   same lifecycle as today's `registerVirtualList`. By default it registers
   the default source over its own data.
3. **The app decides overrides.** Inspect adapts optional `LogViewAPI`
   members into sources per scope; absent members mean the default source.
   Scout wires its own surfaces to the same coordinator.

## The interfaces

### Core contract (shared package)

```ts
// ---- Anchors & matches ------------------------------------------------

type FindAnchorKind = "event" | "message" | "row";

interface FindAnchor {
  kind: FindAnchorKind;
  id: string; // event uuid / message id / listing row id
}

interface FindMatch {
  anchor: FindAnchor;
  /** 0-based occurrence within the anchor's projected text. Omitted by
   *  anchor-granularity sources (log list): stepping is per-anchor and the
   *  surface highlights all in-anchor occurrences. */
  occurrence?: number;
  /** Optional hint: the anchor's position in scope order. Never required —
   *  navigation resolves anchors via the data layer (D8) — but lets a
   *  virtualizer aim before data arrives. */
  ordinal?: number;
}

// ---- Query ------------------------------------------------------------

interface FindQuery {
  /** Matched as case-insensitive literal substring (D3). */
  text: string;
  /** View config shaping the universe. v1: this field only (D5). */
  excludedEventTypes?: string[];
  // future, capability-gated: regex, wordBoundary, caseSensitive
}

// ---- Results ----------------------------------------------------------

interface FindTotal {
  value: number;
  relation: "eq" | "gte"; // "gte" renders as "10,000+" / "M+"
}

type FindStreamItem =
  | { kind: "matches"; matches: FindMatch[] }
  /** Optional, for progressive sources (worker over still-loading data,
   *  server scanning a huge transcript). coverage in [0, 1]. */
  | { kind: "progress"; coverage: number }
  /** Terminal. complete=false means the universe wasn't fully seen
   *  (data still loading, cap hit) — the UI must not present the
   *  total as final. */
  | { kind: "end"; complete: boolean; total: FindTotal };

// ---- Source -----------------------------------------------------------

interface FindCursor {
  /** Resume strictly after this position (or before, going backward). */
  anchor: FindAnchor;
  occurrence?: number;
}

interface FindOptions {
  direction: "forward" | "backward";
  cursor?: FindCursor;
  /** Max matches to stream before ending with relation:"gte". */
  limit?: number;
}

interface FindSource {
  readonly scopeId: string; // "transcript" | "messages" | "log-list" | "json" | ...
  readonly capabilities: {
    /** Source sees the entire universe (vs. best-effort over loaded data). */
    complete: boolean;
    // future: regex, wordBoundary, caseSensitive
  };
  find(
    query: FindQuery,
    opts: FindOptions,
    signal: AbortSignal
  ): AsyncIterable<FindStreamItem>;
}
```

Notes on shape:

- **One method.** Count and matches come from the same scan; a separate
  count endpoint invites the count and the list disagreeing — the exact bug
  class being exterminated. The coordinator's usage pattern: on term change,
  one *survey* call (no cursor, sensible `limit` ~1–2k) fills the match
  window and the total; stepping inside the window is local; stepping past
  it issues cursor calls with small limits. Enter always steps through
  what's known immediately — progress qualifies the denominator, never
  blocks navigation.
- **The worker default implements this trivially** (it materializes
  internally — its business); hawk implements it as keyset-paginated SQL;
  the view server as a scan over the `.eval` file. The UI cannot tell them
  apart.
- **Cancellation** is an `AbortSignal` per query, replacing today's
  generation-counter idioms.

### Surface registration (shared package)

```ts
type RevealOutcome =
  | "revealed"   // anchor rendered; row will self-highlight
  | "missing";   // anchor can't render → coordinator scrolls near it and
                 // flashes (a jump is never silent, D10)

interface FindSurface {
  scopeId: string;
  /** One source per scope. Composition (e.g. log list's listing query +
   *  local overlay; transcript's loaded data + live tail) happens inside
   *  the surface via a mergeFindSources() helper before registration. */
  source: FindSource;
  /** Perform whatever navigation reveals the match: switch swimlane row,
   *  expand collapsed ancestors, scroll (via the anchor-reveal primitive,
   *  D8). Must not require the anchor to be in memory. */
  reveal(match: FindMatch, signal: AbortSignal): Promise<RevealOutcome>;
}

interface FindCoordinator {
  registerSurface(surface: FindSurface): () => void;
  // FindBand consumes: state (term, matches window, activeIndex, total,
  // completeness, progress), next(), previous(), setTerm(), close().
}
```

The active scope is determined by the visible surface (per-tab, as today).
Rows receive the current query + active match via context and self-highlight:
TreeWalker over their own rendered text nodes → DOM `Range`s → CSS Custom
Highlight API (`::highlight(find-match)` / `::highlight(find-active)`);
`<mark>`-wrapping fallback for pre-baseline browsers (Firefox < 140).

### Backend seam (inspect app, `LogViewAPI`)

Optional members, mirroring the existing `post_search`/`get_search_result`
idiom — member absent means the affordance falls back to the default source.
Promise-of-page rather than AsyncIterable (HTTP-friendly, keyset pagination);
the inspect adapter turns pages into the stream:

```ts
// client/api/types.ts — optional members on LogViewAPI
find_transcript?: (
  transcriptDir: string,
  transcriptId: string,
  query: {
    text: string;
    excluded_event_types?: string[];
  },
  page: {
    direction: "forward" | "backward";
    after_anchor?: { kind: "event" | "message"; id: string };
    after_occurrence?: number;
    limit: number;
  }
) => Promise<{
  matches: {
    anchor: { kind: "event" | "message"; id: string };
    occurrence?: number;
    ordinal?: number;
  }[];
  complete: boolean;
  total: { value: number; relation: "eq" | "gte" };
  coverage?: number;
}>;

// Later, for the paginated log list (listing scope):
find_logs?: (…same shape over listing rows…) => Promise<…>;
```

hawk supplies its implementation through `setApiFactory` exactly as it does
for everything else — the members are plain TS functions in-process, so hawk
is free to call its own HTTP endpoints behind them.

## Scope semantics

Three rings; find covers exactly ring 2:

1. **Rendered right now** (the viewport) — what `window.find` searched.
   Never the universe; virtualization is an implementation detail.
2. **Revealable by navigation find may perform** — scrolling a virtualized
   row in, expanding a collapsed panel, switching the selected subagent
   trajectory. The user perceives these as "the app took me there within the
   same view." **This is the searchable universe.**
3. **Reachable only by changing user-set view configuration** — the
   event-type filter, another tab, raw-vs-rendered mode. Out of scope: find
   never silently overrides an explicit choice about what's visible, and a
   count including filtered-out content is a lie.

Per-surface universes:

| Scope | Universe (ring 2) | Anchor | Stepping granularity |
|-------|-------------------|--------|----------------------|
| transcript | all events across all trajectories, minus `hiddenEventTypes` (today's `searchableEvents`) | event uuid | occurrence |
| messages | resolved messages of the sample | message id | occurrence |
| log list | listing rows under current universe + filter + sort | row id | anchor (row) |
| json / scoring / metadata | that tab's own rendered text | tab-local | occurrence |

**Revealability is computed, not discovered.** Today's `SKIP_LIMIT=8` exists
because the only way to learn an event can't render is to try (select row,
wait ~30 frames, give up). The surface has the data to answer up front
(`buildEventToRowMap` + node tree): the projection only includes anchors the
surface can reveal; unrenderable content is **re-anchored** to its nearest
revealable ancestor (hawk's tool_calls → TOOL event move is the precedent)
or excluded. Counted ⇒ reachable, by construction. `data-unsearchable`
regions translate to "excluded from projection" rather than a DOM check.

**The projection is authoritative** — a match exists iff it's in the
projection. This closes today's fuzzy zone where `window.find` could land on
row chrome or unregistered-tab text the counters never saw. (Deliberate,
small behavior change: searching for a timestamp string rendered in row
chrome will no longer hit. If some chrome should be searchable, the fix is
adding it to the projection spec, not re-blessing the DOM.)

**Store invalidation**: match state is keyed on (scope, query text, view
config); toggling the filter or switching tabs resets it — replacing the
counter-registration version hack.

## Projection spec + conformance fixtures

The searchable text per node is a **specification with fixtures**, not
shared code (D9):

- The spec is what `extractEventFields` / `messageSearchText` produce today,
  with one deliberate change: **rendered-form (unescaped) text** instead of
  `JSON.stringify` output for structured values (D11). This kills the
  `prepareSearchTerm` variant machinery — the contract becomes plain
  "case-insensitive substring over the projection," trivially implementable
  in Postgres.
- Fixtures are language-neutral (JSON in / expected text out), live in a
  shared testing export, and run against **both** the TS extractors and
  hawk's import-time text-column builder. A projection change is a fixture
  change first — that's the coordination protocol with hawk.
- Mismatch tolerance is bounded by D10: if a backend's text drifts anyway,
  the total gets less precise, but stepping and highlighting (browser-side
  re-find inside each anchor) stay correct, and a jump is never silent.

## Dependency: anchor reveal in the data layer

Find navigation delegates to a primitive the windowed data layer must grow
regardless, because deep links require it (D8): **given an anchor, fetch its
neighborhood, land the viewport on it** (then flash / highlight). Trivial for
hawk (indexed DB); the view-server / standalone path over a `.eval` file
needs an anchor→offset index to avoid scanning. That requirement belongs to
the windowed-loading design; find is its second consumer after `?event=` /
`?message=` links.

## What gets deleted

The entire `window.find` apparatus: `findExtendedInDOM` (25-attempt loop),
`waitForTextInDOM` (2s polling), `positionSelectionAroundTerm`, the
`selectionchange` reverse-engineering listener, `reselectTermInPanel` (300ms
post-Prism timer), selection save/restore in FindBand, `SKIP_LIMIT` skipping,
`prepareSearchTerm` variants, the `nativeFind` escape hatch, and the
"unregistered tabs count 0 but window.find works" quirk. `ExtendedFindContext`
is replaced by the coordinator (same registration topology, data-level
contract). What survives conceptually: the anchor+occurrence match model
(`SampleMatch`), the extractors (as the projection spec's reference
implementation), `scrollToEvent`'s auto-expand, `FindTargetContext`'s role
(auto-expand signaling), and the log list's membership-query pattern.

## Phasing

Each phase ships independently:

1. **Contract + coordinator + transcript/messages on the default source.**
   Define the shared interfaces; port the transcript (reusing
   `findAllMatches`) and chat list to sources; per-row Highlight-API
   highlighting; delete the `window.find` machinery for these surfaces.
   This alone fixes the reliability complaints and adds highlight-all.
2. **Remaining tabs + scout wiring.** Trivial sources for JSON / scoring /
   metadata; scout app registers its surfaces; `window.find` fully gone.
3. **Backend seam.** `find_transcript` on `LogViewAPI`; view-server
   implementation; conformance fixtures published; hawk implements.
   Projection moves to rendered-form text in the same phase as the fixtures
   (it's a count-visible change — do it once, spec'd).
4. **Log list under pagination.** `find_logs` member; the grid's existing
   membership-query pattern re-targets the shared coordinator so all cmd+f
   surfaces share one implementation.

Worker offload and chunked/range-request scanning for the standalone viewer
are internal optimizations of the default source — they slot in whenever
without contract changes (that's the point of the contract).

## Phase 1 notes (implementation deviations)

Phase 1 landed with the contract as specified, with these recorded
adjustments:

- **`FindSurface.reveal` is a function property, not a method**
  (`reveal: (match, signal) => Promise<RevealOutcome>`). Semantically
  identical; declared this way so the coordinator can detach it without a
  `this` dependency (and the repo's unbound-method lint holds).
- **Step direction is coordinator state, not a `reveal()` parameter.** The
  transcript headroom needs the user's step direction (Next collapses the
  swimlane, Prev reveals it), but `reveal(match, signal)` deliberately
  stays direction-free. Surfaces that care read `lastDirection` from the
  coordinator's state (via a non-subscribing getter).
- **The default in-memory source reports exact totals** (`relation: "eq"`)
  even when `limit` caps the streamed page — it materializes internally,
  so it knows the true count. `"gte"` remains for sources that genuinely
  stop scanning (the coordinator also uses it for interim totals while a
  survey streams). Consequently the "M+" rendering is reachable today only
  through such sources, not the defaults.
- **Transcript revealability = the row map.** Phase 1 excludes anchors
  `buildEventToRowMap` can't address (replacing `SKIP_LIMIT`); an event
  that is in the map but still never mounts degrades to `reveal() →
  "missing"` plus the row-flash rule (D10) rather than being skipped. The
  full "node tree" precomputation can tighten this later without contract
  changes.
- **Surveys cap at 2000 matches, cursor steps page at 200** (open
  question 5's provisional numbers); per-row drawn highlights cap at 1000
  ranges.

## Open questions (for review)

1. **Package home for the contract**: `@tsmono/react` next to the
   coordinator (like `ExtendedFindContext` today), or `inspect-common` so
   non-React code can reference it? Leaning `react` for the coordinator +
   a types-only module for the contract.
2. **Fixture format/location** for cross-language conformance — needs a
   shape hawk's Python tests can consume comfortably (proposal: JSON cases
   in `@tsmono/inspect-common/testing`, mirrored or vendored by hawk).
3. **Does the windowed-data workstream commit to anchor-neighborhood
   fetch** (and the `.eval` anchor→offset index) on a timeline compatible
   with phase 3?
4. **`find_transcript` transport details** for the view server (single
   endpoint vs. reusing an existing router; not contractual — the TS member
   is the contract — but worth settling with the hawk folks in the room).
5. **Cap defaults**: survey `limit` (~1–2k, per VS Code/xterm precedent) and
   drawn-highlight cap — pick numbers during phase 1 with real transcripts.
