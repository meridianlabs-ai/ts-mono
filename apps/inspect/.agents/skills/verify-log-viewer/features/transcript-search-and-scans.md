# Transcript search and scans

The right-side activity rail shared by Transcript and Messages: server-backed
search over events/messages, result navigation and cite labels, plus optional
scanner-score results that link back to transcript evidence.

## Sub-features

- `activity-rail` shows Search and, when available, Scans; reselecting the
  active item closes it and selecting another swaps panels.
- `transcript-search` searches event or message scope with structured query
  options and navigates among results.
- `search-citations` labels matching messages/events in the main content and
  resolves a selected result to the right anchor.
- `sample-scans` extracts scanner scores, groups results, shows references,
  and links result citations to events/messages.
- `rail-persistence` remembers closed/open panel per log and shared panel width
  across samples/reloads.

## How to get to it (user POV)

- Open Transcript or Messages and choose Search on the right activity rail.
- On a sample with scanner scores, choose Scans on the same rail and select a
  result/reference.
- Drag the panel edge, close it, change tabs/samples, and return.

## Driving it with Playwright

- Preconditions: transcript search must be implemented by the active backend;
  scanner UI requires a sample with scanner-shaped scores.
- Open Search, assert the panel region named `Search`, submit a rare fixture
  term in event scope, and assert result count, label, and landing. Repeat in
  Messages to prove scope changes.
- Select a result/reference and assert both panel selection and the labeled
  event/message in main content. Use visible labels rather than CSS color.
- Open Scans, assert fixture-specific scanner/result values, select a cited
  reference, and assert its target becomes visible.
- Resize, switch Transcript ↔ Messages, close, reload, and assert the documented
  per-log choice/global-width persistence.

## Code landmarks

- Rail orchestration and persistence: `apps/inspect/src/app/samples/SampleDisplay.tsx`.
- Inspect search adapters: `apps/inspect/src/app/samples/transcript/search/`.
- Shared search state/UI/query logic:
  `packages/inspect-components/src/transcript-search/` and transcript search
  source hooks under `packages/inspect-components/src/transcript/search/`.
- Scanner extraction/UI: `apps/inspect/src/app/samples/scans/`.
- Backend methods: search functions under `apps/inspect/src/client/api/`, with
  VS Code behavior in `client/api/vscode/`.
- Regression coverage: search/reference-label tests, scan reference tests,
  and transcript deep-link tests. No standing real-backend search proof exists
  unless the fixture backend supports it.

## Gotchas

- Search scope follows the active tab: `events` in Transcript, `messages` in
  Messages. A result set from the wrong scope can look like missing data.
- Search and Scans share one dock and cannot be open simultaneously.
- The default dock opens Scans only when the sample has scans and no stored
  choice exists. An explicit user close persists and must not be forced open.
- Search capability differs by backend. Do not replace an unavailable backend
  call with client-side DOM search and claim feature coverage.
- Result labels are merged with scanner cite labels. Avoid overwriting one
  context when the other updates.
