# Log viewer verification map

This directory is the maintained, behavior-level map of the inspect log
viewer. Agents use it to translate a report, screenshot, or changed file into
the relevant user journeys, code, and proof. Read this index first, then open
only the feature files that match the surface under investigation.

## Baseline preconditions

- Run `doctor.sh` and require every line `ok` (see SKILL.md → Doctor).
- Launch through the Playwright config (SKILL.md → Launch): a real
  `inspect view` server on `VERIFY_VIEW_SERVER_PORT` reading
  `VERIFY_LOG_DIR`, and the viewer at `http://localhost:5179`.
- Never drive an instance this run did not start (`reuseExistingServer` is
  false for exactly this reason).
- The default fixture dir `~/code/viewer-validation/logs` is deterministic
  mockllm output. Ground truth used by the standing spec:

| Fixture log                                                         | Facts to assert against                                                                                                                                                             |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `2026-07-07T21-47-35-00-00_viewer-rich_M58v4LGnsyG2Gh3hwXxpeP.eval` | task `viewer_rich`, 5 samples, accuracy 0.8; sample 1/epoch 1: input `What is 2+2?`, assistant `The answer is 4.`, target `4`, score `includes: C`, 17 events (model, score, spans) |
| `...viewer-rich_9GnzUtiNvgakGMKyahfeyu.json`                        | a second `viewer_rich` log in JSON format — task-name matches (e.g. filtering "rich") intentionally return 2 rows, not 1                                                            |
| `...viewer-arithmetic_7hC9oRtKWCL5jqeA7zUWfq.eval`                  | task `viewer_arithmetic`, 3 samples, accuracy 0.0                                                                                                                                   |
| `...viewer-error_RbzFqVPn2h6kkuqHN3gt3F.eval`                       | status `error` — exercises error display                                                                                                                                            |
| `...viewer-cancelled_*.eval` (7 files)                              | one task with many runs; one run cancelled                                                                                                                                          |
| `...viewer-grid_ixJgGBWxnCrNnk7qzyHU7S.eval`                        | 24 samples — enough rows to exercise the samples grid                                                                                                                               |

## Driving conventions

The viewer is a hash-routed React app (`#/...` URLs). Prefer, in order:

1. `getByRole` — `grid` (named "Evaluation logs" / "Samples"), `row`,
   `gridcell`, `columnheader`, `tab`, `dialog`, `button`, `navigation`.
2. `getByLabel` / aria-label, then `getByPlaceholder`.
3. The few explicit test ids: `error-panel`, `score-grid`, `find-band-*`.
4. Stable DOM ids: `#<tabId>-contents` tab panels, `[id^="sample-heading-"]`,
   `#turn-<uuid>`.
5. `[class*="_moduleClass_"]` CSS-module fragments only as a last resort.

Deep-link instead of clicking through when the feature under proof isn't the
navigation itself:
`/#/logs/<encodeURIComponent(file)>/samples/sample/<id>/<epoch>/<tab>`.
Sample tab ids: `messages transcript scoring usage metadata error retries json`.
Log workspace tab ids: `samples json info models task timeline error`.

Readiness is always a web-first assertion on content (`expect(...).toBeVisible()`),
never `networkidle` or fixed sleeps. The app boot gate blocks on
`GET /api/logs`, then `/api/log-files`, `/api/log-headers`, `/api/logs/:file`.

Do not import `test`/`expect` from `apps/inspect/e2e/fixtures/app.ts` — that
fixture auto-enables MSW and silently mocks `/api`. Import from
`@playwright/test`.

## Proof and skip reporting

- Assert values that are actually in the fixture being driven (task name,
  input text, score value), then screenshot the end state into `evidence/`.
- Capture the action and the resulting state (e.g. list before click, log
  view after), not only the final screen.
- Report an unreachable path with the attempted selector and the unmet
  precondition; a skipped entry point is not verified by a different path.

## Using this map for bug triage

Start from what the user can see, not from a guessed component name:

| Report or screenshot contains                         | Start with                                                                                     |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Tasks/Folders/Samples switcher, rows, columns, footer | [Log list](./log-list.md), [Sample list](./sample-list.md), [Shared grid behavior](./shared-grid-behavior.md) |
| Breadcrumbs, theme, loading bar, viewer options       | [Application chrome](./application-chrome.md)                                                  |
| Wrong URL, back behavior, wrong log/sample after nav  | [Routing and viewer modes](./routing-and-viewer-modes.md), then [Cross-surface journeys](./multi-surface-journeys.md) |
| Log title, status, tags, metrics, download            | [Log header and editing](./log-header-and-editing.md), [Scores](./scores.md)                    |
| Summary, dataset, solver, scorer, metadata            | [Evaluation info](./evaluation-info.md)                                                        |
| Task ids, sandbox, args, config, early stopping       | [Task and configuration](./task-and-configuration.md)                                          |
| Tokens, cost, model roles, connections                | [Models and usage](./models-and-usage.md), [Sample usage and metadata](./sample-usage-and-metadata.md) |
| Run history, markers, lanes, config changes           | [Evaluation timeline](./evaluation-timeline.md)                                                |
| Sample input/target/answer header or prev/next         | [Sample summary and navigation](./sample-summary-and-navigation.md)                             |
| Conversation bubbles, tool calls, markdown, images    | [Sample messages](./sample-messages.md), [Rendered content and media](./rendered-content-and-media.md) |
| Event outline, swimlanes, focus mode, turn controls   | [Transcript](./transcript.md), [Transcript events and focus](./transcript-events-and-focus.md)  |
| Search or Scans right rail, cite labels                | [Transcript search and scans](./transcript-search-and-scans.md)                                |
| Error, limit, cancelled, retry attempt                 | [Errors, limits, and retries](./errors-limits-and-retries.md)                                  |
| Blank, stale, perpetually loading, live update         | [Loading, live evals, and refresh](./loading-live-refresh.md)                                  |
| Raw/JSON/copy/download/print                           | [Export, JSON, and print](./export-json-print.md)                                               |
| YAML evaluation flow                                  | [Flow files](./flow-files.md)                                                                  |

When the symptom crosses routes, modes, or persistence boundaries, also read
[Cross-surface journeys](./multi-surface-journeys.md). A screenshot can locate
the visible renderer, but stale or incorrect data often belongs to the owner
named in that feature's `Code landmarks`, not the leaf component.

## Full sweep

Walk these groups top to bottom. Within a feature, cover every reachable entry
point and the success, empty, loading, error, and persistence paths affected by
the change. Finish with the cross-surface journeys.

### Application and navigation

- [Application chrome](./application-chrome.md) — breadcrumbs, back/home,
  theme, loading bar, and viewer diagnostics.
- [Routing and viewer modes](./routing-and-viewer-modes.md) — hash routes,
  Tasks/Folders prefixes, deep links, single-file and embedded modes.
- [Flow files](./flow-files.md) — read-only YAML evaluation-flow display.

### Collection views and grids

- [Log list](./log-list.md) — Tasks/Folders views, listing real logs,
  opening one, column filters, find band.
- [Sample list](./sample-list.md) — the samples grid inside a log and the
  top-level Samples view.
- [Shared grid behavior](./shared-grid-behavior.md) — sorting, resizing,
  reordering, keyboard selection, column visibility, and per-scope state.

### Log workspace

- [Log header and editing](./log-header-and-editing.md) — task/model identity,
  status and results, tags, metadata edits, path copy, log download.
- [Evaluation info](./evaluation-info.md) — dataset/solver/scorer summary and
  evaluation metadata.
- [Task and configuration](./task-and-configuration.md) — identifiers,
  revision, timing, sandbox, args, effective config, early stopping.
- [Models and usage](./models-and-usage.md) — model/role configuration, token
  usage, cost, connection history, and config changes.
- [Sample messages](./sample-messages.md) — the conversation rendering in a
  sample's Messages tab.
- [Transcript](./transcript.md) — the event timeline, outline, and turn
  navigation in a sample's Transcript tab.
- [Scores](./scores.md) — score column in the log list, log-level scoring
  detail, and the sample Scoring tab.
- [Evaluation timeline](./evaluation-timeline.md) — run-level activity,
  samples, model connections, retries, and configuration changes over time.
- [Export, JSON, and print](./export-json-print.md) — raw/rendered mode, JSON
  tabs, clipboard actions, downloads, and the print route.

### Sample detail

- [Sample summary and navigation](./sample-summary-and-navigation.md) — sticky
  input/target/answer/score header, invalidation, sibling navigation.
- [Sample usage and metadata](./sample-usage-and-metadata.md) — Usage and
  Metadata tabs, trees, model roles, timing, tokens, and cost.
- [Errors, limits, and retries](./errors-limits-and-retries.md) — sample/log
  failures, limits, cancelled states, and retry attempts.
- [Transcript events and focus](./transcript-events-and-focus.md) — event-type
  renderers, turn navigation, event deep links, and focused-turn view.
- [Transcript search and scans](./transcript-search-and-scans.md) — right rail,
  event/message search, scan results, cite labels, and panel persistence.
- [Rendered content and media](./rendered-content-and-media.md) — markdown,
  structured records, tool calls, citations, images, and safe remote media.

### Runtime and cross-surface behavior

- [Loading, live evals, and refresh](./loading-live-refresh.md) — listing and
  detail loading, streaming samples, cache/database refresh, and recovery.
- [Cross-surface journeys](./multi-surface-journeys.md) — route-prefix and
  selection continuity, state isolation, live completion, and edit refresh.

## Entry contract

Every feature file uses the same five H2s:

1. `Sub-features`
2. `How to get to it (user POV)`
3. `Driving it with Playwright`
4. `Code landmarks`
5. `Gotchas`

Keep entries behavior-level and short enough to use without reading source.
`Code landmarks` is the inspect-specific extension to the verification-map
pattern: name the narrowest current owners and high-value regression tests,
not every dependency in the render tree.
