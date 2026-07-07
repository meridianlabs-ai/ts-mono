---
name: verify
description: Build/launch/drive recipe for verifying apps/inspect changes end-to-end in a real browser
---

# Verifying apps/inspect changes

## Handle

- **Dev server:** `pnpm dev` in `apps/inspect` serves the app at `http://localhost:5173` from working-tree source (Vite; no build step needed). Check if one is already running first: `lsof -nP -iTCP:5173 -sTCP:LISTEN` — and confirm its cwd is *this* checkout (`lsof -p <pid> | grep cwd`); a sibling inspect_scout checkout runs a lookalike server.
- Point it at real logs by opening the browser at `/` (it lists the log dir the server was started with).
- **e2e port gotcha:** Playwright e2e uses port 5174 and collides with the sibling inspect_scout checkout — `lsof -ti :5174 | xargs kill` before `pnpm e2e <spec>`.

## Drive (Playwright script, headless)

`@playwright/test` is a devDependency; from a standalone Node script resolve it via
`createRequire(".../apps/inspect/package.json")("@playwright/test")`.

Useful selectors (stable, used by e2e too):

- Grid: `page.getByRole("grid")`; rows: `getByRole("row")` (first row is the header).
- Column header: `getByRole("columnheader").filter({ has: page.getByText("Task", { exact: true }) })`.
- Column filter funnel (hover-revealed): hover the header, then `getByRole("button", { name: "Filter <columnId>", exact: true })`.
- Filter popover: operator `#<columnId>-op` (`<select>` of UI operators: contains/…), value `#<columnId>-val` (string columns use placeholder "Filter"), range end `#<columnId>-val2`, commit `getByRole("button", { name: "Apply" })`.
- Applied-filter chrome: `getByRole("button", { name: "Reset Filters" })`; item count bottom-right ("1 / 33 items").

## Gotchas

- **No persistence in plain-browser mode**: `src/client/storage/index.ts` returns `undefined` outside VS Code, so zustand persist is a no-op — filters/sort/widths never survive a browser reload. Don't report that as a bug; persistence is only observable in the VS Code webview.
- `<input type="number">` silently swallows non-numeric typing, so "invalid number input" can't be exercised through the UI value inputs.
- Screenshots: `page.screenshot({ path })` after a short `waitForTimeout` — the grid virtualizes, so row counts via `getByRole("row")` only see rendered rows; filter down to < 1 viewport of rows before counting, or read the "N / M items" footer.
