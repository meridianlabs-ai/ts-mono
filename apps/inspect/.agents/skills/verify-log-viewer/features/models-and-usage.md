# Models and usage

The Models workspace tab and shared usage views: model/role configuration,
token and cost tables, timing, connection-limit history, config changes, and
links into the evaluation timeline.

## Sub-features

- `models-config` groups generation configuration and arguments by model and
  by role, including role aliases and list-valued role mappings.
- `models-usage` shows input/output/total tokens and cost by model/role.
- `models-connections` shows connection-limit changes and history during the
  run.
- `models-timeline-link` opens Timeline focused on a model or config change.
- `event-usage` reuses the usage components inside model-call transcript
  events; sample-level aggregation is in `sample-usage-and-metadata.md`.

## How to get to it (user POV)

- Open a completed log and choose `Models`.
- Expand model/role rows, inspect token/cost details, and follow a config or
  connection-history link to Timeline.
- Open a model-call transcript event to see the per-call use of the same
  vocabulary.

## Driving it with Playwright

- Use a fixture with recorded `model_usage` or `role_usage`; assert exact model
  names and token/cost values from the log.
- Assert role aliases where configured and verify list-valued roles do not
  collapse into comma-corrupted labels.
- Select any segmented/detail controls by visible label and assert the table
  changes to the expected grouping.
- For connection history, assert a known limit transition and its timestamp,
  then follow View Timeline and assert the matching lane/filter.
- Running logs intentionally suppress settled usage tables; cover their live
  status through `loading-live-refresh.md`.

## Code landmarks

- Log surface: `apps/inspect/src/app/log-view/tabs/ModelsTab.tsx`.
- Shared usage rendering and derivation:
  `packages/inspect-components/src/usage/`, especially `UsagePanel.tsx`,
  `ModelTokenTable.tsx`, `configsForUsage.ts`, `cost.ts`, and `roleAliases.ts`.
- Model-role normalization: `packages/inspect-common/src/utils/modelRoles.ts`.
- Timeline handoff: `apps/inspect/src/app/log-view/useShowTimeline.ts`.
- Regression coverage: tests beside the usage utilities and
  `apps/inspect/src/app/log-view/tabs/timeline/timelineData.test.ts`.

## Gotchas

- Usage and cost are absent when the log did not record them; zero and absent
  are different states.
- The Models tab does not show settled usage while status is `started`.
- Model roles may map to one name or a list (for example majority-vote
  grading). Preserve the list through formatting and grouping.
- Config changes affect which configuration applies to later events; never
  display one static config as if it covered the whole run.
