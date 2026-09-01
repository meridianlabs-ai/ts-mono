# Transcript

The Transcript tab of a sample detail: the event timeline (solver spans,
model calls, scoring, state changes) with a collapsible outline sidebar,
per-event expansion, and turn navigation.

## Sub-features

- `transcript-render` shows the event timeline for the sample.
- `transcript-outline` sidebar outline mirrors the span/turn structure.
- `transcript-events` model-call events show summary/info/messages/api tabs.
- `transcript-turns` next/previous turn navigation and focused turn view.
- `transcript-filter` switches Default/Debug/None/custom event visibility and
  expands/collapses event bodies.
- `transcript-swimlanes` aligns the virtual event list, outline, optional
  timeline lanes, minimap, and branch/fork structure.
- `transcript-live` appends/backfills events, follows the tail, and settles
  without duplicate rows or stale progress.

## How to get to it (user POV)

- Open a sample — Transcript is the default sample tab.
- Direct: `#/logs/<encodedLogPath>/samples/sample/<id>/<epoch>/transcript`.
- A single event: append `/event?event=<eventId>`.

## Driving it with Playwright

Preconditions:

- Baseline launch; viewer-rich sample 1/epoch 1 (17 events: model, score,
  spans) as the target.

- **Panel renders.** Deep-link, then `page.locator("#transcript-contents")`
  is visible.
- **Events present.** `panel.getByText(/model call/i).first()` is visible
  (the fixture's mockllm call renders as "Model Call: mockllm/model"); the
  score event renders a SCORE block with target `4` and score `C`.
- **Outline.** `page.locator(".transcript-outline")` is visible and contains
  the span names (`generate`, `scoring` for this fixture).
- **Expand/collapse.** Toolbar
  `page.getByRole("button", { name: /collapse|expand/i }).first()` toggles
  event bodies.
- **Turn navigation.** `getByRole("button", { name: "Next turn" })` /
  `{ name: "Previous turn" }`; per-turn anchors are `#turn-<eventUuid>`;
  `getByRole("link", { name: "Open focused turn view" })` enters focus mode,
  `getByRole("button", { name: "Exit focus mode" })` leaves it.
- **Proof.** Screenshot the timeline showing the model call and score event;
  assert fixture-specific texts (input, answer, score value).

For individual renderer tabs/deep links/focus mode, read
[Transcript events and focus](./transcript-events-and-focus.md). For the Search
and Scans rail, read [Transcript search and scans](./transcript-search-and-scans.md).

## Code landmarks

- Inspect tab integration: `apps/inspect/src/app/samples/SampleDisplay.tsx` and
  `apps/inspect/src/app/samples/transcript/` (monolithic and chunked panels).
- Shared layout/virtual list/outline/timeline:
  `packages/inspect-components/src/transcript/`, especially
  `TranscriptLayout.tsx`, `TranscriptVirtualList*.tsx`, `outline/`,
  `timeline/`, and `hooks/`.
- Event transform/filtering: `packages/inspect-components/src/transcript/transform/`
  and `eventFilter.ts`.
- Data sources: `apps/inspect/src/log_data/sampleStream.ts`,
  `chunkedSampleQuery.ts`, and chunked modules under `log_data/chunked/`.
- Regression coverage: `apps/inspect/e2e/transcript-baseline.spec.ts`,
  `transcript-events.spec.ts`, `timeline.spec.ts`, `turn-navigation.spec.ts`,
  and extensive colocated transcript tests.

## Gotchas

- Outline rows are only selectable via CSS-module fragments
  (`[class*="eventRow"]`) — brittle; prefer asserting on outline text.
- One-turn samples disable turn-nav buttons — use a multi-turn fixture when
  proving `transcript-turns`.
- Some turn-nav store writes are debounced with no DOM signal; the existing
  suite (`e2e/turn-navigation.spec.ts`) uses explicit `waitForTimeout` there
  as a documented exception — copy that pattern only for that case.
- Event bodies lazy-render; assert visibility per event, not DOM counts.
- Chunked logs window transcript events and messages independently; an empty
  shell `events` array does not mean there is no transcript.
- Default exclusions are dynamic: store events with rich renderers can be
  visible by default even if generic store events are hidden.
- Outline/list/timeline selection and scroll are coupled. Fixes that update
  only one surface often cause drift, stale highlighting, or snap-back.
- Successful live completion may return to the top; error/cancelled completion
  deliberately stays at the tail.
