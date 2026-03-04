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

### Import ordering — restore prettier plugin post-migration

During migration, `@ianvs/prettier-plugin-sort-imports` was removed from
`@tsmono/prettier-config` and replaced with `eslint-plugin-import`'s
`import/order` rule (in `@tsmono/eslint-config/base.js`). This was done so
ts-mono produces identical import formatting to www, minimizing diff noise
while both locations coexist.

**Post-migration**, consider restoring the prettier plugin for a single-tool
import formatting story. Steps:

1. Add `@ianvs/prettier-plugin-sort-imports` back to
   `tooling/prettier-config/package.json`:
   ```json
   "dependencies": {
     "@ianvs/prettier-plugin-sort-imports": "^4.7.1"
   }
   ```

2. Restore the plugin config in `tooling/prettier-config/index.js`:
   ```js
   export default {
     trailingComma: "es5",
     plugins: ["@ianvs/prettier-plugin-sort-imports"],
     importOrder: [
       "<BUILTIN_MODULES>",
       "",
       "<THIRD_PARTY_MODULES>",
       "",
       "^@tsmono/",
       "",
       "^[.][.]",
       "",
       "^[.]/",
     ],
   };
   ```
   Note: the `importOrder` above splits parent (`^[.][.]`) and sibling
   (`^[.]/`) relative imports into separate groups with a blank line, matching
   eslint's `import/order` group behavior.

3. Decide whether to keep or drop `eslint-plugin-import`:
   - The prettier plugin also **alphabetizes named specifiers** inside `{}`
     (e.g. `{ FC, createContext }` → `{ createContext, FC }`). The eslint rule
     does not enforce this unless `named: true` is set in `alphabetize`.
   - If you keep both, they may conflict on blank-line placement. Pick one as
     the source of truth, or configure them to agree.
   - Recommendation: use the prettier plugin for formatting and remove the
     eslint `import/order` rule to avoid conflicts.

4. Run `pnpm format` and `pnpm lint:fix` across all packages to normalize.

### Preserve `.prettierignore` files when updating source

When pulling in new source from upstream, do not overwrite the `.prettierignore`
files. Each app/package may have its own `.prettierignore` for its local
`pnpm format` script, and the root `.prettierignore` covers the repo-wide
`pnpm format`. Merge any new ignore entries rather than replacing the files.
