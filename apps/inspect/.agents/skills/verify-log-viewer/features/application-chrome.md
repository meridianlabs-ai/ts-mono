# Application chrome

The navigation frame shared by log lists, log workspaces, sample detail, and
flow files: breadcrumbs, back/home controls, theme, viewer options, and the
thin loading indicator below the navbar.

## Sub-features

- `chrome-breadcrumbs` shows the log root and current folder/file path, with
  middle segments collapsed when space is tight.
- `chrome-back-home` returns to the parent surface or the root listing while
  preserving the active Tasks/Folders/Samples route family.
- `chrome-theme` cycles system/light/dark in standalone builds and follows the
  host theme in VS Code.
- `chrome-loading` shows listing, log, or sample work in the bar below the
  navbar without replacing already-useful content.
- `chrome-options` shows the log directory, Inspect/Scout/schema versions,
  local database counts, and Clear Local Database.

## How to get to it (user POV)

- The navbar is present on every collection, log, sample, and flow route.
- Navigate into a folder, log, and sample to see the breadcrumb and back/home
  targets change.
- Use the theme button at the right edge. Open the adjacent Viewer Options
  button for diagnostics and the local-data reset action.

## Driving it with Playwright

- Scope shared controls to `page.getByRole("navigation", { name: "breadcrumb" })`.
- Navigate into a nested path and assert the visible breadcrumb labels. Use
  the first two links for back/home only after checking their `href` values;
  icon-only links do not have useful accessible names today.
- Theme: click the theme control by its current accessible label, assert the
  root theme attribute/class changes, reload, and assert persistence. Skip the
  mode picker in VS Code because the host owns the theme.
- Open Viewer Options with
  `getByRole("button", { name: /viewer information and options/i })`.
  Assert the served log directory and Inspect version, not only that a popover
  appeared.
- Clearing local data is destructive to the viewer cache. Prove the cancel-free
  action only against the isolated fixture origin, then assert the success
  message and that the listing repopulates.

## Code landmarks

- Chrome composition: `apps/inspect/src/app/navbar/ApplicationNavbar.tsx`,
  `apps/inspect/src/app/navbar/Navbar.tsx`,
  `apps/inspect/src/app/log-list/ViewerOptionsButton.tsx`, and
  `apps/inspect/src/app/log-list/ViewerOptionsPopover.tsx`.
- Theme ownership: `apps/inspect/src/app/App.tsx`,
  `apps/inspect/src/state/userSettings.ts`, and
  `packages/inspect-components/src/theme/`.
- Breadcrumb sizing and shared loading UI:
  `packages/react/src/hooks/useBreadcrumbTruncation.ts` and
  `packages/react/src/components/LoadingBar.tsx`.
- Loading derivation and cache reset:
  `apps/inspect/src/state/selectedLogDetails.ts` and
  `apps/inspect/src/log_data/imperativeLogData.ts`.
- Regression coverage: `apps/inspect/e2e/top-level-views.spec.ts`,
  `apps/inspect/src/app_config/appConfig.test.ts`, and breadcrumb hook tests in
  `packages/react/src/hooks/useBreadcrumbTruncation.test.tsx`.

## Gotchas

- The navigation landmark's accessible name is `breadcrumb`, not the current
  folder name.
- The loading bar folds several independent activities together; a stuck bar
  can originate in listing sync, log detail, or sample loading. Follow the
  active route to `loading-live-refresh.md` before editing navbar code.
- Theme state is per browser origin. A different verification port is a fresh
  preference store.
- Clear Local Database acts immediately and then acquisition repopulates it;
  an increasing row count after the success message is expected.
