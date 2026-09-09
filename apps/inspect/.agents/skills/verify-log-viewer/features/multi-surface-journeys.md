# Cross-surface journeys

Journeys whose bugs appear on one screen but cross route, selection, data,
scroll, or persistence boundaries. Read the linked feature files for per-
surface selectors; use this file to sequence them.

## Sub-features

- `route-family-round-trip` preserves Tasks/Folders/Samples meaning and grid
  state through log/sample detail and back.
- `selection-load-continuity` keeps URL, selected log/sample/tab, and rendered
  data on the same identity during rapid navigation.
- `sample-tab-sibling` moves between samples without leaking tab scroll,
  transcript focus, search/scans selection, or prior sample content.
- `live-completion` carries a running sample/log into its settled status
  without duplication, reorder, stale badges, or scroll surprise.
- `edit-refresh` updates header, Task/Info cards, listing columns, local
  database, and cache from one tag/metadata save.
- `preference-isolation` persists theme, grid, sample view, rail, and timeline
  state at their documented global/per-scope/per-log boundaries.

## How to get to it (user POV)

- Start from each top-level route family, drill into details, act, and navigate
  back/sideways rather than deep-linking directly.
- Repeat with rapid clicks, reload, browser back/forward, a running eval, and
  a second log/sample whose content is unmistakably different.

## Driving it with Playwright

- **Route round-trip:** Tasks → sort/filter/resize → log → sample → back twice;
  assert `/tasks`, grid state, and row selection. Repeat Folders with a nested
  path and Samples with its cross-log columns.
- **Rapid identity:** delay log/sample A, immediately select B, and assert A's
  late response never replaces B's URL/header/body. Move from a running sample
  to a completed sibling and back.
- **Sample isolation:** scroll Transcript, open Search/Scans, switch Messages,
  move next sample, and assert new summary/content/top position with no old
  focus or labels. Returning later starts a fresh visit where documented.
- **Live settle:** follow a running tail through success, error, and cancelled
  terminal variants; assert summaries/messages/events are ordered and not
  duplicated and terminal scroll behavior matches the outcome.
- **Edit refresh:** save tags/metadata, assert all visible mirrors update,
  reload, then restore fixture state.
- **Preferences:** test one global (theme/panel width), one scoped grid, and one
  per-log choice; assert both persistence and non-leakage.

## Code landmarks

- Route/selection orchestration: `apps/inspect/src/app/routing/`,
  `apps/inspect/src/state/actions.ts`, log/sample containers, and selection
  hooks in `apps/inspect/src/state/hooks.ts`.
- Persistence boundaries: `apps/inspect/src/state/userSettings.ts`, state
  slices/property bags, `useSampleGridState.ts`, and view-specific hooks.
- Live/data handoff: `apps/inspect/src/log_data/` and
  `apps/inspect/src/client/remote/`.
- Edit invalidation: title-view editors, `useLogEditAffordance`, and
  `log_data/imperativeLogData.ts`.
- High-value regression suites: `apps/inspect/e2e/log-list-filters.spec.ts`,
  `top-level-views.spec.ts`, `message-deeplink.spec.ts`,
  `turn-navigation.spec.ts`, and log-data/loader integration tests.

## Gotchas

- A direct deep link proves the destination renderer, not the entry path,
  history behavior, or state handoff.
- Persisted state has intentional scope. Treating every value as global or
  resetting everything on navigation both create regressions.
- Late async responses are a common source of screenshots with mixed identity
  (new URL/navbar, old body). Assert three independent identity signals.
- Successful live completion scrolls back to the top; error/cancelled completion
  stays at the tail so the terminal error remains visible.
- The browser harness covers standalone view-server mode. Repeat critical
  journeys in static, VS Code, or embedder hosts when the change touches their
  backend/bootstrap capability boundary.
