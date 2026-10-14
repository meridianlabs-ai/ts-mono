# Routing and viewer modes

Hash-based navigation between Tasks, Folders, Samples, logs, sample tabs,
print, and focused events, across standalone directory mode, single-file
mode, static hosting, VS Code, and the embeddable library.

## Sub-features

- `route-families` keeps `/tasks`, `/logs`, and `/samples` semantics while
  drilling into a log or sample and navigating back.
- `log-tabs` addresses `samples`, `task`, `models`, `timeline`, `info`, `error`,
  and `json` without confusing a path segment with a tab id.
- `sample-tabs` addresses `transcript`, `messages`, `scoring`, `usage`,
  `metadata`, `error`, `retries`, and `json` by sample id/epoch or UUID.
- `sample-deep-links` handles `?event=`, `?message=`, `?follow=`, focused
  `event` routes, and the non-tab `print` route.
- `viewer-modes` resolves the view-server, static HTTP, VS Code, or embedder
  backend and optionally bypasses the collection router in single-file mode.
- `new-tab-links` renders every control that navigates to another view as a
  real `<a href>`: grid rows, log and sample tabs, prev/next sample, the
  Tasks/Folders/Samples switcher, "View on timeline", the timeline's sample
  links, Flow, focus-mode exit, and reference/outline links. Plain clicks
  navigate in place; Cmd/Ctrl/Shift/middle-click and "Open link in new tab"
  are the browser's. Inside VS Code they fall back to buttons (grid rows to
  `div role="row"`); outline and reference anchors stay `<a>`.
- `log-location-gate` holds a cross-origin `?log_dir=` / `?log_file=` on a
  browser-direct (static HTTP) backend behind an approval prompt; no request
  reaches that origin until the user opens it.

## How to get to it (user POV)

- Switch the top segmented control, open a folder/log/sample, change tabs,
  then use back and home.
- Paste or reload any deep link. Encoded log paths and sample ids containing
  `/` must round-trip without changing identity.
- Single-file mode is entered through `?log_file=...` or host-provided
  embedded state. `?log_dir=...` chooses a directory without selecting a
  file.

## Driving it with Playwright

- Assert both the visible destination and `page.url()` after every navigation
  action. A URL-only assertion misses stale content; a content-only assertion
  misses the wrong route family.
- Cover Tasks → log → sample → sibling sample → back and Folders → nested
  folder → log → back. The prefix must remain `/tasks` or `/logs` respectively.
- Build routes with `encodeURIComponent` for the complete log file and the
  sample id. Include a string id containing `/` when a fixture provides one.
- Reload a sample tab and a `?message=` or `?event=` deep link; assert the
  requested tab/content, not whichever selection is persisted in the store.
- Viewer-mode variants require their real production boundary. Do not claim
  static, VS Code, or embedded behavior from the view-server harness; report
  those variants skipped unless launched in that host.
- **New-tab links.** Assert the control's `href` (it is `toFullUrl(route)`, so
  it keeps the page's `?query`), then Cmd/Ctrl-click with
  `link.click({ modifiers: ["ControlOrMeta"] })` inside
  `Promise.all([context.waitForEvent("page"), ...])`. Assert the new tab's
  location and that the current page's URL is unchanged, and still check a
  plain click navigates in place.
- **Log-location gate.** Only a static-HTTP host triggers it, so drive it the
  way `apps/inspect/e2e/log-location-trust.spec.ts` does: assert
  `getByTestId("log-location-gate")` /
  `getByRole("alertdialog", { name: /Open logs from/ })`, that no request
  reaches the proposed origin, then `Open` or `Don't open` (which strips the
  proposal from the URL).

## Code landmarks

- Route table and dispatch: `apps/inspect/src/app/routing/AppRouter.tsx`,
  `RouteDispatcher.tsx`, and `SamplesRouter.tsx`.
- URL parse/build contract: `apps/inspect/src/app/routing/url.ts`; log/sample
  transitions live in `logNavigation.ts` and `sampleNavigation.ts`.
- Selection/load ordering: `apps/inspect/src/app/routing/loaders/` and
  `apps/inspect/src/app/log-view/LogViewContainer.tsx`.
- Mode resolution: `apps/inspect/src/app_config/`, especially
  `urlLogSource.ts`, `resolveBackend.ts`, and `singleFileMode.ts`.
- Link-proposed locations: `apps/inspect/src/app_config/LogLocationGate.tsx`
  and `logLocationTrust.ts`; e2e in `apps/inspect/e2e/log-location-trust.spec.ts`.
- In-app links: `packages/react/src/components/inAppLink.tsx` (`InAppLink`,
  `inAppHref`, `inAppLinkClick`, `isNewTabClick`); tabs, segments, and
  chevrons build on it in `TabSet.tsx`, `SegmentedControl.tsx`, and
  `NextPreviousNav.tsx`. Hrefs come from `toFullUrl` in `url.ts`.
- Host bridge and embed composition: `apps/inspect/src/app/App.tsx`,
  `apps/inspect/src/main.tsx`, `apps/inspect/src/embed.tsx`, and
  `apps/inspect/src/index.ts`.
- Regression coverage: `apps/inspect/src/app/routing/url.test.ts`,
  `urlLinking.test.tsx`, loader tests, `app_config/*test.ts`, and
  `apps/inspect/e2e/top-level-views.spec.ts` (including its "Open in new tab"
  tests).

## Gotchas

- React Router decodes `%2F`; route hooks deliberately parse
  `location.pathname` so slash-bearing sample ids remain one segment.
- Log files may themselves contain words equal to tab ids. The parser searches
  validated trailing segments; avoid hand-splitting routes elsewhere.
- Single-file mode renders directly from `AppLayout` and bypasses the normal
  child route table. A fix in `RouteDispatcher` may need a matching branch in
  the single-file path.
- Route selection and async loading are separate concerns. Reports showing the
  right URL with old content usually belong to loaders/state, not `url.ts`.
- `print` and focused `event` are pages, not entries in the normal sample tab
  set.
- `page.url()` stays `about:blank` for a background tab opened by a native
  link gesture. Read `tab.evaluate(() => location.href)` (retrying while its
  first navigation replaces the context) instead.
- Sample prev/next and sample tabs build the href and the plain-click route
  from one computation (`sampleNavigation.ts`); a new tab landing somewhere
  different from a plain click there is a route bug, not a link-component
  bug.
- `?log_dir=` / `?log_file=` on the same origin, or on a proxied backend (view
  server, VS Code, embedder), loads without the gate; browser-direct
  cross-origin locations prompt, and so do `data:` or unparseable ones.
