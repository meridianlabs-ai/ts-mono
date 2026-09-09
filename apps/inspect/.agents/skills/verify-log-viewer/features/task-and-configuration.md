# Task and configuration

The Task workspace tab and configuration summaries: task/run identity,
revision and package provenance, sandbox, timing, effective eval/generate
configuration, mid-run changes, early stopping, and task arguments.

## Sub-features

- `task-identity` shows task/run ids, revision link, Inspect packages, tags,
  sandbox and timestamps.
- `task-config` shows effective evaluation and generation settings.
- `task-config-changes` marks settings changed during the run and links to the
  relevant evaluation-timeline window.
- `task-early-stopping` shows manager, skipped count, and metadata.
- `task-args` renders task-specific arguments.

## How to get to it (user POV)

- Open a log and choose `Task`.
- Use Copy controls in Task Info, expand configuration records, or click a
  changed-config chip to jump to Timeline.
- Tags can also be edited from the Task Info card when log editing is enabled.

## Driving it with Playwright

- Assert fixture-specific Task ID/Run ID, start/end/duration, sandbox, and at
  least one config or task-arg value.
- For a revision fixture, assert both visible commit text and the anchor href.
- With config updates, assert the effective final value and change badge, then
  click View Timeline and assert Timeline selection/filter state.
- With early stopping, assert manager and skipped count plus a known metadata
  leaf. Report the section unavailable on ordinary fixtures.

## Code landmarks

- Tab/cards: `apps/inspect/src/app/log-view/tabs/TaskTab.tsx` and
  `ConfigCard.tsx`.
- Header summary and timeline handoff:
  `apps/inspect/src/app/log-view/title-view/SecondaryBar.tsx` and
  `apps/inspect/src/app/log-view/useShowTimeline.ts`.
- Effective config folding: `packages/inspect-common/src/utils/effectiveConfig.ts`
  and the generated log types in `packages/inspect-common/src/types/`.
- Generic records/copy: `packages/inspect-components/src/content/`.
- Regression coverage: effective-config tests, Task/metadata component tests,
  `apps/inspect/src/app/log-view/tabs/timeline/timelineData.test.ts`, and URL tests.

## Gotchas

- The visible configuration is effective state after ordered updates, not
  necessarily the initial `evalSpec.config`.
- Revision links support HTTPS and SSH-style GitHub origins. Link-building
  bugs belong to `@tsmono/util`'s git helpers rather than TaskTab JSX.
- Empty args, early stopping, sandbox config, or change history are valid and
  suppress their sections.
- Clicking a change chip carries selection through a property bag; verify both
  route/tab and focused timeline state.
