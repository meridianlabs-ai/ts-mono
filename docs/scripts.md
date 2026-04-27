# Script Conventions

## Responsibility Split

**Turbo** owns task orchestration and parallelism. **Workspace `package.json` scripts** are leaf-level and single-concern — each does one thing.

### Turbo's job

- Run atomic tasks (`lint`, `typecheck`, `format:check`, `test`) across all workspaces in parallel
- Express ordering constraints via `dependsOn` (e.g. `lint` and `typecheck` depend on `^build`)
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
├── css-types     (workspaces with generated CSS module declarations)
├── lint          (all workspaces, in parallel; depends on css-types)
├── typecheck     (all workspaces, in parallel; depends on css-types)
├── format:check  (workspaces that have it, in parallel)
└── check         (no-op, runs after all above complete)
```

`lint` and `typecheck` depend on same-workspace `css-types` where that task
exists, so a clean checkout has generated CSS module declarations before
type-aware ESLint or TypeScript runs.

`build` has `dependsOn: ["^build"]`, meaning upstream packages are built first.

## Adding a new workspace

1. Define leaf scripts: `lint`, `typecheck`, `test` (and `css-types` / `format:check` if the package needs them)
2. Add `"check": "true"` so Turbo includes it in `turbo run check`
3. Do **not** add orchestration logic to the workspace's scripts — that's Turbo's job
