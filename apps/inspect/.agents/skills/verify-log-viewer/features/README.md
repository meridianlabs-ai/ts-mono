# Log viewer verification map

This directory is the maintained source for verifying the user-facing
behavior of the inspect log viewer. Read this index before driving the app,
then use the matching feature file as the recipe.

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
Sample tab ids: `messages transcript scoring activity usage metadata error retries json`.
Log workspace tab ids: `samples json info models task timeline error` (the
`timeline` tab is labeled "Activity" in the UI; the id is unchanged).

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

## Features

- [Log list](./log-list.md) — Tasks/Folders views, listing real logs,
  opening one, column filters, find band.
- [Sample list](./sample-list.md) — the samples grid inside a log and the
  top-level Samples view.
- [Sample messages](./sample-messages.md) — the conversation rendering in a
  sample's Messages tab.
- [Transcript](./transcript.md) — the event timeline, outline, and turn
  navigation in a sample's Transcript tab.
- [Scores](./scores.md) — score column in the log list, log-level scoring
  detail, and the sample Scoring tab.
- [Sample activity](./sample-activity.md) — the sample Activity tab: stacked
  operational bands, marker rail, filterable history list, click-through to
  the Transcript.
