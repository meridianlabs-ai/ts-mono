# Migration Notes

Items to address when creating the real monorepo from this trial (`tsmono`).

## Source changes required in inspect_scout

### `logger.ts` — build-time globals need runtime guards

`src/utils/logger.ts` uses Vite `define` globals (`__DEV_WATCH__`,
`__LOGGING_FILTER__`, `__SCOUT_RUN_SCAN__`) that are replaced at build time.
When this file moves to a shared package, it is no longer processed by the
consuming app's Vite pipeline during tests — vitest only applies `define`
substitutions to files within the project root. The bare globals throw
`ReferenceError` in any context that doesn't go through Vite (tests, SSR,
Node scripts, etc.).

**Fix**: wrap each global in a `typeof` guard with a safe fallback:

```ts
const isDevWatch = typeof __DEV_WATCH__ !== "undefined" && __DEV_WATCH__;
const loggingFilter =
  typeof __LOGGING_FILTER__ !== "undefined" ? __LOGGING_FILTER__ : "*";
```

Audit all files moving to the shared package for similar `declare const` /
`define` patterns — any global injected by `vite.config.ts` needs the same
treatment.

## General migration workflow

When pulling in updated source from `inspect_scout`, copy only the **source
files** (`.ts`, `.tsx`, `.css`, etc.). Do **not** overwrite `package.json`,
`tsconfig.json`, ESLint configs, Prettier configs, or other tooling files —
the monorepo versions have been customized with workspace dependencies,
shared configs, and monorepo-specific scripts. Use the existing ones in
`tsmono` and manually merge any new dependency additions.

## Tooling / config

### Root `pnpm test` script

The trial repo did not originally wire up `pnpm test`. Added:

- `package.json`: `"test": "turbo run test"`
- `turbo.json`: `"test": { "dependsOn": ["^build"] }`

Ensure the real repo includes these from the start.

### Preserve `.prettierignore` files when updating source

When pulling in new source from upstream, do not overwrite the `.prettierignore`
files. Each app/package may have its own `.prettierignore` for its local
`pnpm format` script, and the root `.prettierignore` covers the repo-wide
`pnpm format`. Merge any new ignore entries rather than replacing the files.
