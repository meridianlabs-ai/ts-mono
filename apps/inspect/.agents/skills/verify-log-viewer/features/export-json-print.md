# Export, JSON, and print

Ways to inspect or take data out of the viewer: rendered/raw content mode,
log and sample JSON tabs, copy actions, capability-gated downloads, message
links, and the dedicated printable sample page.

## Sub-features

- `display-raw` toggles structured content between rich renderers and exact
  payload views where supported.
- `log-json` renders the log header JSON, copies it, or offers a download when
  it exceeds the render-size limit.
- `sample-json` renders and downloads a complete loaded sample.
- `sample-copy-download` copies UUID/messages/transcript and downloads sample
  JSON/messages/transcript when the host supports files.
- `sample-print` opens a no-opener print route, preserves the selected content
  tab, and formats page headings/breaks for printing.
- `message-links` copies absolute deep links to individual messages/events in
  hosted environments.
- `event-evidence` exports only checked transcript events via Copy, Download,
  or Print.

## How to get to it (user POV)

- Log workspace → `JSON`; use Copy JSON or the large-file download action.
- Sample detail → `JSON`; use Raw, Copy, Download, or Print in the tab toolbar.
- Cmd/Ctrl-P from a standalone sample opens the dedicated print page. VS Code
  leaves printing to the host.
- Use a message/event link affordance when the hosted surface exposes it.
- In Transcript, press Select; every selectable event header then shows a
  checkbox. Check events, then use Copy, Download, or Print.

## Driving it with Playwright

- Assert JSON contains a fixture-specific field/value and excludes client-only
  derived summary fields. Click Copy JSON and verify clipboard text.
- Toggle Raw on a structured tool/message fixture and assert the exact payload
  replaces the projection; toggle back and assert the rich view returns.
- Use Playwright download events for each capability-gated item; assert file
  name and a known content substring.
- Open Print or press Cmd/Ctrl-P, assert a new page at the `/print` route,
  `window.opener === null`, literal metadata text, selected-tab content, and
  printable sample identity.
- Do not invoke copy/download menu items when their source (for example settled
  messages on a live sample) is intentionally unavailable.
- Evidence: press `Select`, check events with
  `getByRole("checkbox", { name: "Select event" })` (shift-click another for
  a range of visible rows; the toolbar reads `Select · N`), then assert the
  Copy/Download menu shows
  "Selected events (N)" and that `Print · N` opens `/print` with `events=`
  params rendering only those events. Clear with
  `getByRole("button", { name: "Clear selection and exit" })`.

## Code landmarks

- Log JSON: `apps/inspect/src/app/log-view/tabs/JsonTab.tsx`.
- Sample toolbar/JSON: `apps/inspect/src/app/samples/SampleDisplay.tsx` and
  `SampleJSONView.tsx`; message export is `apps/inspect/src/log_data/messagesExport.ts`.
- Evidence selection: `packages/inspect-components/src/transcript/selection/`
  (`EventSelectCheckbox.tsx`, `TranscriptSelectTool.tsx`,
  `transcriptSelection.ts`) and selection state in
  `apps/inspect/src/state/sampleSlice.ts`.
- Print route/rendering: `apps/inspect/src/app/samples/print/`,
  `apps/inspect/src/app/routing/RouteDispatcher.tsx`, and URL builders in
  `apps/inspect/src/app/routing/url.ts`.
- Download boundary: `apps/inspect/src/components/DownloadPanel.tsx`,
  `DownloadLogButton.tsx`, and `apps/inspect/src/client/api/`.
- Regression coverage: `apps/inspect/e2e/viewer-xss.spec.ts`, print component
  tests, URL tests, and messages-export tests.

## Gotchas

- The log JSON tab intentionally removes client-derived `sampleCount`,
  `sampleErrorCount`, and `sampleLimits` from the serialized header.
- JSON larger than 10 MB is not rendered when downloads are available.
- Copy Messages and download Messages are absent for live streams without a
  settled export source; this is not a broken menu.
- Raw is shared display state, so switching tabs can make a renderer appear to
  change elsewhere. Always record the toggle state in a visual bug report.
- Popup safety is part of correctness: print/new-tab paths must not expose
  `window.opener`, and user strings must remain literal.
- Select exists only on a non-chunked Transcript tab; switching tab or sample
  starts unlatched and empty. While a selection exists, Copy, Download, and
  Print act on it rather than the whole sample.
