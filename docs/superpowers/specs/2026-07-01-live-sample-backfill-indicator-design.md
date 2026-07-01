# Live-Sample Backfill Indicator — Design

**Date:** 2026-07-01
**Branch:** `feature/live-sample-backfill-indicator`

## Goal

When viewing an in-progress sample, visually distinguish two states that are
currently indistinguishable:

1. **Backfilling** — already-happened transcript events are still loading (for
   large/long-running samples this can take a long time, especially over S3).
2. **Live** — everything that has happened is loaded, and we are waiting on an
   ongoing `generate()` or tool call at the tail.

Today both render the same bottom-of-transcript "running/generating" ellipsis.
Users checking on an eval almost never want to wait for the live `generate()`,
but they *do* want to wait for the existing backlog to finish loading — so
telling the two apart matters.

Secondary goal: modestly speed up the S3 backfill (client-side only).

## Background — how it works today

### Live-sample event streaming

- The viewer polls running samples via `createSamplePolling`
  (`apps/inspect/src/state/samplePolling.ts`), 2s cadence, keeping forward
  cursors (`eventId`, `attachmentId`, `messagePoolId`, `callPoolId`).
- Each poll calls `get_log_sample_data(...)`; the server returns everything
  *after* the cursors. Steady state fetches only the delta; the first poll (no
  cursor) must pull the whole backlog.
- Two transports, selected in `client-api.ts` `get_log_sample_data`:
  - **proxy** (`/pending-sample-data`, local SQLite buffer): returns all
    matching data in one response; never sets `has_more`.
  - **direct** (`/pending-sample-data-urls`, S3 / `log_shared` filestore):
    chunked. Segments are fetched via presigned URLs,
    `SEGMENT_CAP_PER_CALL = 25` per call (`remotePendingSampleData.ts`), the
    response carries `has_more`, and the poll loop re-fires immediately
    (`return "immediate"`, `samplePolling.ts:298`) until caught up.

### Why S3 backfill is slow (context, not fixed here)

- Segments are written **one per 10s sync flush**
  (`DEFAULT_LOG_SHARED = 10`), each a separate S3 object holding one member per
  active sample. A sample's backlog = roughly one S3 GET per 10s window it was
  alive — count scales with **wall-clock duration**, not event count.
- The browser caps ~6 concurrent connections per S3 host (HTTP/1.1), so the
  25-per-call `Promise.all` really runs ~6-wide. `SEGMENT_CAP_PER_CALL` paces
  work; it does not reduce total round trips.

### The running/generating indicators

- `running` (`SampleDisplay.isRunning`) means only "sample not yet complete."
- The footer indicators are **derived from the tail of the currently-loaded
  events**: `transcriptToolsRunning()`
  (`TranscriptVirtualListComponent.tsx:268`) inspects the last model event and
  whether its tool calls have completed tool events yet; a pending model event
  shows a "generating" indicator.
- During backfill, events load **oldest → newest**, so the "last" loaded event
  is a *historical* one whose tool events simply haven't loaded yet. The
  event-derived indicators are therefore not just ambiguous but can be
  **outright wrong** mid-backfill.
- `SampleStatus = "ok" | "loading" | "streaming" | "error"`; both backfill and
  live collapse to `"streaming"`.

## Scope

- **In:** distinguish backfilling vs live via a distinct indicator; client-only
  backfill speed-up (pipelining).
- **Out (deferred):** determinate progress bar / event-count denominator
  (needs a small additive server field); any storage/segment-format change.
- The proxy (local SQLite) transport never sets `has_more`, so it has no
  visible incremental backfill phase — this feature targets the direct/S3
  transport, which is where the reported pain occurs. On the proxy transport
  `backfilling` is simply never true, and behavior is unchanged.

## Design

### 1. State: a single `backfilling` boolean

Add one purely-presentational field to the sample slice
(`apps/inspect/src/state/sampleSlice.ts`), set alongside `setRunningEvents`:

```ts
backfilling?: boolean
```

In the `samplePolling.ts` poll callback, where running events are pushed
(~line 287), also set the flag from the `has_more` already in hand:

- `backfilling = sampleDataResponse.has_more === true`

**Latch-to-live rule:** once a sample has reached the live phase
(`has_more` falsy) for the first time, treat subsequent transient
`has_more === true` (a live burst producing > cap segments) as still live —
do not flip back to backfilling. Only a new `startPolling` for a
sample resets the latch. This avoids flicker between "Loading events…" and
"Generating…". The initial backlog drain is the only true backfilling phase.

`SampleStatus` is unchanged, so all existing `"loading" | "streaming"` "busy"
checks keep working. `backfilling` is cleared when the sample completes
(status → `"ok"`) and on polling reset.

### 2. Footer / indicator UX

Thread `backfilling` down `SampleDisplay` → `TranscriptPanel` →
`TranscriptLayout` → `TranscriptVirtualListComponent` (a new optional prop
mirroring `running`).

- **While `backfilling`:** suppress the event-derived footer
  (`toolsRunning` / `ToolRunningFooter`) and the pending-model "generating"
  state — they are unreliable mid-backfill — and render a distinct
  **`LoadingEventsFooter`**: a spinner + "Loading events…" (no count).
  Visually distinct from `GeneratingIndicator` so the two are unmistakable.
- **While live** (caught up, still running): exactly today's behavior
  (`GeneratingIndicator label="running"` / pending-model generating).

Net effect: the tail ellipsis means *only* "waiting on a live generate()/tool
call." "Still loading history" gets its own clearly-different indicator.

### 3. Client-side backfill speed-up (no format change)

In `remotePendingSampleData.ts` and the poll loop, keep the ~6 S3 connections
saturated instead of idling during the `getUrls` round trip and JSON parse
between batches:

- **Pipeline:** prefetch the next batch's URLs (and begin its downloads) while
  the current batch is still parsing, rather than the strict
  "fetch URLs → download 25 → parse → next iteration" serialization.
- **Fewer control round trips:** raise `max_segments` per `getUrls` call so
  there are fewer round trips to the inspect server for presigned URLs
  (downloads stay ~6-wide regardless; this removes the inspect-server hop from
  the critical path more often).
- Keep the `setTimeout(0)` yield so the renderer stays responsive.

This does not beat the browser's 6-connection ceiling; it removes the dead
time between batches — the realistic client-only win.

### 4. Progress denominator (deferred, future extension)

Ship §1–3 with an indeterminate "Loading events…" indicator. If a determinate
bar is later wanted, add a separate `backfillProgress?: { loaded; total? }`
slice field plus an additive `remaining` / `total_segments` field on the
`PendingSampleUrls` response (the manifest already knows the segment count —
additive, not a format change). No rework of the `backfilling` boolean.

## Components touched

| Unit | Change |
|------|--------|
| `apps/inspect/src/state/sampleSlice.ts` | Add `backfilling?: boolean` + setter |
| `apps/inspect/src/state/samplePolling.ts` | Set `backfilling` from `has_more` with latch-to-live; clear on reset/complete |
| `apps/inspect/src/client/remote/remotePendingSampleData.ts` | Pipeline URL-fetch with segment download; larger `max_segments` |
| `apps/inspect/src/app/samples/SampleDisplay.tsx` | Read `backfilling`, pass to `TranscriptPanel` |
| `.../transcript/TranscriptPanel.tsx`, `packages/inspect-components/.../TranscriptLayout.tsx`, `.../TranscriptVirtualListComponent.tsx` | Thread `backfilling`; suppress event-derived footer while backfilling; render `LoadingEventsFooter` |

## Testing

- **Unit (state):** given a sequence of poll responses, `backfilling` follows
  `has_more`, latches to live after first live poll (transient `has_more`
  stays live), and clears on completion / polling reset.
- **Unit (transport):** pipelined fetch returns segments in id order and
  applies the cursor filter identically to the current implementation; larger
  `max_segments` behaves the same as smaller batches, just fewer calls.
- **Component:** `TranscriptVirtualListComponent` renders `LoadingEventsFooter`
  (not `ToolRunningFooter`) when `backfilling`, and the normal indicators when
  live; a mid-backfill tail that would trip `transcriptToolsRunning` shows the
  loading footer, not "running".
- **Proxy transport:** `backfilling` never true (no `has_more`), behavior
  unchanged.

## Non-goals / risks

- Not changing segment storage format or the proxy transport.
- Not raising true fetch concurrency beyond the browser's per-host cap.
- Risk: mis-latching could leave a sample stuck showing "Loading events…";
  covered by the latch unit tests and by clearing on completion.
