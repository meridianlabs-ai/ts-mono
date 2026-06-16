# @tsmono/storybook

Central Storybook for the monorepo. `main.ts` scans every package for
`*.stories.@(ts|tsx)`, so stories live next to the code they exercise (e.g.
`apps/inspect/src/**`), not here.

```bash
pnpm --filter @tsmono/storybook storybook        # dev server on :6006
pnpm --filter @tsmono/storybook storybook:build  # production build
```

## Two kinds of stories

1. **Leaf-component stories** — render one component with props/args. Mock at the
   `ClientAPI` boundary with a stub object passed via `ApiProvider`. See
   `apps/inspect/src/components/*.stories.tsx`.

2. **Full-app / interaction stories** — render the real `<App/>` (router + Zustand
   store + bootstrap effects) and drive state entirely through **MSW**-mocked
   network responses. See `apps/inspect/src/app/App.stories.tsx` and the
   `withMockedApp` decorator in `apps/inspect/src/mocks/story-decorator.tsx`.

MSW is wired globally in `.storybook/preview.ts` (`initialize()` + `mswLoader` +
global `defaultHandlers`). The service worker lives in `public/mockServiceWorker.js`
(regenerate with `pnpm dlx msw init public --save`). Mock handlers and typed data
factories are shared with the Playwright e2e suite in `apps/inspect/src/mocks/`
(re-exported from `apps/inspect/e2e/fixtures/`).

## Pitfalls for full-app MSW stories — read before editing

These cost real debugging time. Don't relearn them.

- **Per-story `parameters.msw.handlers` REPLACES the global array — it does not
  concatenate.** A story that sets its own handlers loses every boot endpoint
  (`/api/events`, `/api/log-dir`, bare `/api/logs`, `/api/log-files`, …) and 404s
  on bootstrap. Always wrap per-story handlers with `withDefaults([...])` from
  `apps/inspect/src/mocks/handlers.ts` so the boot defaults remain as a fallback.
  MSW matches **first-registered-wins**, so story overrides must come *before* the
  defaults (which is what `withDefaults` does).

- **`get_log_root` hits bare `GET /api/logs`** (no file segment), distinct from
  `GET /api/logs/:file`. `initLogDir` calls it on every boot; if it's unmocked the
  whole load chain aborts. It's in `defaultHandlers`; list views that need a
  populated listing should override it with real `logs`.

- **`storybook:build` passing does NOT mean the stories work.** It only proves they
  compile. The handler-merge bug above builds fine and fails at runtime. **Verify in
  a real browser**, e.g. `pnpm --filter @meridianlabs/log-viewer story-smoke`
  (loads each story's iframe in headless Chromium and asserts rendered content +
  no unexpected 404s / JS errors). Requires the dev server running on :6006.

- **An `@msw/playwright` e2e run against the app dev server is NOT a substitute.**
  `@msw/playwright`'s `network.use()` *appends* handlers; Storybook parameters
  *replace* them. A green e2e run there can hide broken Storybook stories. Test the
  actual Storybook iframes.

- **Expected/benign 404s:** `/api/pending-samples` (HTTP 404 *is* the "NotFound"
  signal for non-running evals), `/api/eval-set`, `/api/flow` (optional resources).
  The smoke script already allowlists these.

- **Known limitation:** full-app stories on the log *overview* route
  (`/logs/{file}`) log one background error, `No database available for
  replication`. The overview route's `loadLogFromPath → syncLogs` races the
  bootstrap `syncLogs`; the second call skips replication setup. Views render
  correctly regardless. Fixing it means changing production code
  (`logsSlice`/`replicationService`) and is out of scope for these stories.

- The decorator re-initializes the store every render and uses fresh in-memory
  `ClientStorage`, so stories don't bleed state. It sets `window.location.hash`
  from `parameters.initialRoute` before rendering (the router is a module-level
  `createHashRouter`).
