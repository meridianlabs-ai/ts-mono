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

## `eslint-suppressions.json`

Every workspace carries an ESLint [bulk-suppressions][] ledger recording the
type-assertion violations (`@typescript-eslint/no-unsafe-type-assertion`,
`@typescript-eslint/consistent-type-assertions`) that predate those rules. It
is a per-file, per-rule count, read automatically from the workspace root —
`lint` needs no extra flag. Only the recorded backlog is excused: a cast in an
unlisted file fails, and a listed file that goes over its count un-suppresses
*every* cast in it, so adding one to a file with a backlog means clearing that
file.

The ledger is a burn-down list, not a standard. It has two rules:

- **Never grow it to land code.** A boundary a cast genuinely needs gets an
  `eslint-disable-next-line … --` directive naming the boundary, at the cast,
  where a reviewer sees it.
- **Prune when you fix.** Removing a counted cast leaves a stale entry, and
  `lint` fails on stale entries by design (`--pass-on-unpruned-suppressions`
  is deliberately not set) — so the count in the diff always matches the
  casts in the diff. Run `pnpm lint:prune` (`turbo run lint:prune`) and
  commit the result.

`lint:prune` rewrites the ledger in place over exactly the file set that
workspace's `lint` covers, so it is `"cache": false` in `turbo.json`.

The files are Prettier-ignored per workspace: ESLint rewrites them without a
trailing newline on every prune, which would otherwise fail `format:check`.

[bulk-suppressions]: https://eslint.org/docs/latest/use/suppressions

## Adding a new workspace

1. Define leaf scripts: `lint`, `lint:prune`, `typecheck`, `test` (and `format:check` if the package has its own Prettier config; `generate:css` if it has CSS modules)
2. Add `"check": "true"` so Turbo includes it in `turbo run check`
3. Do **not** add orchestration logic to the workspace's scripts — that's Turbo's job
