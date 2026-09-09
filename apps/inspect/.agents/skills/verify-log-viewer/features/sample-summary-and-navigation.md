# Sample summary and navigation

The sample-detail frame: breadcrumb navbar, previous/next sample controls,
sticky summary of input/target/answer/score/status, invalidation warnings, tab
bar, and scroll/header state while moving between samples.

## Sub-features

- `sample-identity` shows sample id/epoch and task/model context.
- `sample-summary` renders input, target, answer, score, timing, limits,
  retries, fallbacks, provenance, and error/cancelled state when present.
- `sample-header-collapse` condenses the summary while scrolling and starts
  collapsed for event/message deep links.
- `sample-siblings` moves previous/next within the currently filtered sample
  set and disables controls at the ends.
- `sample-visit-state` keeps tab scroll positions within one visit but starts
  a different sample or later revisit at the top.
- `sample-invalidation` warns when configuration changes make a sample stale.

## How to get to it (user POV)

- Open any row in a log's Samples tab or the top-level Samples view.
- Use Previous/Next buttons or ArrowLeft/ArrowRight to move among sibling
  samples.
- Scroll content to collapse the summary; use an event/message deep link to
  land below it.

## Driving it with Playwright

- Assert `[id^="sample-heading-"]` contains fixture-specific input, target,
  answer, and score plus visible sample id/epoch in the navbar.
- Move next and previous with buttons and keyboard. Assert URL identity,
  summary content, enabled/disabled ends, and that filtering limits siblings.
- Scroll one tab, switch tabs and back (position retained), move to a sibling
  (starts at top), then return later (fresh visit starts at top).
- Deep-link to `?message=` or `?event=` and assert the target lands below the
  collapsed sticky header without a visible jump.
- With config updates, assert the invalidation banner and the log-level
  invalidation status agree.

## Code landmarks

- Detail shells/navigation: `apps/inspect/src/app/log-view/LogSampleDetailView.tsx`,
  `apps/inspect/src/app/samples-panel/SampleDetailView.tsx`,
  `apps/inspect/src/app/samples/SampleNavbar.tsx`, and
  `apps/inspect/src/app/routing/sampleNavigation.ts`.
- Summary: `apps/inspect/src/app/samples/SampleSummaryView.tsx`,
  `header-v2/`, `status/`, and `error/`.
- Tab/visit/scroll orchestration: `apps/inspect/src/app/samples/SampleDisplay.tsx`
  and `packages/react/src/hooks/useChromeNavOwnership.ts`.
- Selection/data adapters: `apps/inspect/src/state/hooks.ts`,
  `apps/inspect/src/log_data/sampleData.ts`, and
  `apps/inspect/src/app/samples/sampleDataAdapter.ts`.
- Regression coverage: `apps/inspect/e2e/turn-navigation.spec.ts`,
  `message-deeplink.spec.ts`, loader tests, and sample summary/status tests.

## Gotchas

- Sibling navigation respects the active filtered sample set, not necessarily
  every sample in the log.
- Sample ids can be strings and can contain `/`; URL encoding errors often
  present as a navigation/selection bug.
- Scroll snapshots are visit-scoped on purpose. Returning through history is
  not guaranteed to restore an earlier visit's offset.
- Deep-link navigation temporarily owns the chrome/scroll position. A natural
  user scroll hands ownership back; header and transcript bugs can therefore
  share an origin.
- A summary can render from sample-summary data before the full sample body
  loads. Do not fetch the full sample just to fill fields already on summary.
