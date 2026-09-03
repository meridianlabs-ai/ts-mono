# Transcript events and focus

The event cards inside a sample Transcript and the single-turn/single-event
navigation surfaces: model, tool, score, state, span, sandbox, approval,
subtask, logger/info/error and lifecycle renderers; event tabs; turn labels;
deep links; and focused-turn view.

## Sub-features

- `event-renderers` maps each event type to a labeled, expandable card with
  event-specific content and timing.
- `model-tool-events` show messages, API/raw data, usage, tool input/output,
  errors, approvals, retry chips, and stop reasons.
- `score-state-events` show typed score values/reasons and readable state
  records/diffs.
- `event-deeplink` resolves events/messages across timelines, hidden filters,
  collapsed spans, branches, and lanes.
- `turn-navigation` labels model turns and supports previous/next, `j`/`k`, and
  focused-turn entry/exit.
- `focus-page` renders one focused turn or event with sample navbar/error
  context, then returns to the same transcript anchor.

## How to get to it (user POV)

- Open a sample's Transcript and expand event cards or their Summary/Info/
  Messages/API/Error tabs.
- Use turn chevrons, `j`/`k`, or Open focused turn view.
- Follow an event/message link or direct `.../event?event=<id>` URL.

## Driving it with Playwright

- Use fixtures that contain each event class under proof. Assert the visible
  event label plus fixture-specific content; do not prove all renderers from a
  single generic `model call` assertion.
- Expand/collapse a model and tool event, switch their inner tabs, and assert
  error/usage/input/output values.
- Follow deep links to an event inside a non-main timeline or collapsed/hidden
  region; assert the UI reveals it and the target lands below sticky chrome.
- Navigate turns with buttons and `j`/`k`, enter focus, step again, exit, and
  assert return to the same turn without stale scroll.
- Hold/repeat `j` and `k` only in the dedicated keyboard path; assert one turn
  per keypress and symmetric traversal.

## Code landmarks

- App integration: `apps/inspect/src/app/samples/transcript/TranscriptPanel.tsx`,
  `apps/inspect/src/app/samples/event/SampleEventView.tsx`, and deep-link state
  in `apps/inspect/src/app/routing/sampleNavigation.ts`.
- Event renderers and panels: `packages/inspect-components/src/transcript/`,
  especially `TranscriptViewNodes.tsx`, the `*EventView.tsx` files, and
  `event/`.
- Deep-link/turn resolution: `findTimelineForDeepLink.ts`,
  `resolveMessageToEvent.ts`, `turnNavigation.ts`, and hooks under
  `transcript/hooks/`.
- Transform pipeline: `packages/inspect-components/src/transcript/transform/`.
- Regression coverage: `apps/inspect/e2e/transcript-events.spec.ts`,
  `turn-navigation.spec.ts`, and colocated renderer/deep-link/turn tests.

## Gotchas

- One logical turn can span model, tool, approval, branch, and retry events.
  Turn navigation uses derived boundaries, not every model-event row.
- Hidden/collapsed content must be revealed for a deep link without permanently
  rewriting the user's filter/collapse preferences.
- A single event can belong to another timeline/lane; searching only the main
  flattened list causes plausible but wrong landings.
- Tool renderers are shared with Messages in several places. Determine whether
  the screenshot is a transcript event card or conversation tool block before
  choosing the owner.
- Focus mode must surface sample errors from every turn, not just the terminal
  one.
