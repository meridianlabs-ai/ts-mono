# Script Conventions

## Responsibility Split

**Turbo** owns task orchestration and parallelism. **Workspace `package.json` scripts** are leaf-level and single-concern — each does one thing.

### Turbo's job

- Run atomic tasks (`lint`, `typecheck`, `format:check`, `test`) across all workspaces in parallel
- Express ordering constraints via `dependsOn` (e.g. `lint` and `typecheck` depend on `generate:css`)
- Compose atomic tasks into higher-level workflows (e.g. `check` depends on `lint`, `typecheck`, and `format:check`)

### Workspace scripts' job

- Define the **leaf command** for each task (e.g. `"lint": "eslint . --max-warnings 0"`)
- Never re-implement Turbo's orchestration — no `pnpm lint && pnpm typecheck` inside a `check` script
- Composite scripts like `check` should be `"true"` (no-op) since all composition lives in `turbo.json`'s `dependsOn`

### Why `check` scripts exist but are no-ops

Turbo only runs a task's `dependsOn` chain for workspaces that have the task defined. A workspace without a `check` script won't get its `lint` or `typecheck` run as part of `turbo run check`. So every workspace that should participate in `check` must have `"check": "true"`.

## Current task graph

```
turbo run check
├── lint          (all workspaces, in parallel)
├── typecheck     (all workspaces, in parallel)
├── format:check  (workspaces that have it, in parallel)
└── check         (no-op, runs after all above complete)
```

`build` `dependsOn: ["^build", "generate:css"]`; `lint` and `typecheck` both `dependsOn: ["generate:css", "^generate:css"]`, so CSS-module typings (own and upstream) exist first.

### `generate:css`

Workspaces with CSS modules define `"generate:css": "cmk"`. It generates `*.module.css.d.ts` typings co-located next to each stylesheet; the outputs are gitignored (and excluded from lint/format).

## `TSMONO_TYPED_LINT`

The five `@typescript-eslint/no-unsafe-*` rules are off unless `TSMONO_TYPED_LINT` is set. Every workspace `lint` script sets it inline (`TSMONO_TYPED_LINT=1 eslint …`), so batch runs (`pnpm lint`, `--filter` runs, turbo, CI) enforce them; editor eslint servers never run the scripts, leaving those errors to tsc there.

## Adding a new workspace

1. Define leaf scripts: `lint`, `typecheck`, `test` (and `format:check` if the package has its own Prettier config; `generate:css` if it has CSS modules)
2. Add `"check": "true"` so Turbo includes it in `turbo run check`
3. Do **not** add orchestration logic to the workspace's scripts — that's Turbo's job
