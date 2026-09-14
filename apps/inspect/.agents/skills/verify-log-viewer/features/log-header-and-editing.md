# Log header and editing

The expanding/collapsing header above every log workspace: task and model,
file path, tags, status, sample count, score summary, run summary, path copy,
log download, and edit affordances.

## Sub-features

- `header-identity` shows task, model/roles, filename, dataset and run facts.
- `header-status` distinguishes started, success, cancelled, and error states.
- `header-results` chooses the headline metric, bounds wide score summaries,
  and opens the full Scoring Detail dialog.
- `header-collapse` condenses the header while scrolling a workspace tab and
  expands it again at the top.
- `header-tags` edits tags from the header or Task tab when the backend allows
  log edits.
- `header-actions` copies the resolved log path and downloads `.eval` when the
  host advertises the capability.

## How to get to it (user POV)

- Open any log. The expanded header sits between the application navbar and
  workspace tabs.
- Scroll a long tab such as Info or Task to collapse it.
- Click a tag or the Tags/Edit pill to edit. Copy and download sit beside the
  filename when supported.
- `All scoring...` appears only when the compact result area cannot show all
  metrics.

## Driving it with Playwright

- Assert fixture-specific task/model/filename plus the correct status or score
  value. A screenshot should include the header and workspace tabs together.
- Use a long tab to scroll beyond the collapse threshold; assert compact
  content replaces the expanded slot, then scroll to top and assert expansion.
- For a multi-metric fixture, open `All scoring...` and assert the dialog named
  `Scoring Detail` contains every expected metric.
- Editing requires a backend exposing `edit_log`. Exercise open → cancel,
  validation failure, successful save, and refreshed header/Task-tab state.
  Restore fixture tags/metadata in cleanup if they are mutable.
- Copy path should equal the absolute log directory plus the selected relative
  file when the server exposes `absLogDir`.

## Code landmarks

- Header composition: `apps/inspect/src/app/log-view/title-view/TitleView.tsx`,
  `PrimaryBar.tsx`, `SecondaryBar.tsx`, and `CollapsedTitleBar.tsx`.
- Results and tags: `ResultsPanel.tsx`, `ScoreGrid.tsx`, `TagsField.tsx`,
  `TagStrip.tsx`, and `EditTagsDialog.tsx` in `title-view/`.
- Metadata editing is rendered from Info but shares the same edit boundary:
  `EditMetadataDialog.tsx`, `editErrors.ts`, and
  `apps/inspect/src/state/hooks.ts` (`useLogEditAffordance`).
- Backend capability: `apps/inspect/src/client/api/client-api.ts` and the
  view-server/VS Code implementations under `client/api/`.
- Regression coverage: title-view component tests,
  `apps/inspect/e2e/metrics-overflow.spec.ts`, and API client tests.

## Gotchas

- Error logs with `continue_on_fail` can show both usable results and an error
  status; do not reduce status rendering to a single mutually exclusive card.
- Compact results intentionally prioritize a declared headline metric, not
  the first score in source order.
- Edit failures have distinct meanings: 412 means reload/retry, 409 means the
  log is in progress, and 400 is validation. Preserve the tailored messages.
- Header collapse is driven by the active tab's scroll container. A report
  limited to one tab can originate in a missing/wrong `scrollRef`.
- Download and edit controls are capability-gated and validly absent in some
  hosts.
