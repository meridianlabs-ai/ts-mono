# ts-mono

TypeScript monorepo powering the web UIs of
[Inspect AI](https://inspect.aisi.org.uk/) and
[Inspect Scout](https://github.com/meridianlabs-ai/inspect_scout): the eval
log viewer, the Scout viewer, and the shared packages behind them.

## How this repo is consumed

Parent repos (`inspect_ai`, `inspect_scout`) embed this monorepo as a **git
submodule** and commit the built output, so Python contributors and end users
never need Node.js. If you're doing frontend work inside a parent repo, read
the [submodule guide](docs/submodule-guide.md) — it covers setup, keeping the
submodule in sync, and the build-and-bump workflow.

You can also clone and develop this repo standalone. The one caveat: type
generation reads OpenAPI schemas from the Python repos, so `types:generate`
needs either submodule mode or a `TSMONO_PYTHON_ROOT_*` environment variable
pointing at a local checkout (see [Generated types](#generated-types)).

## Getting started

Requires Node.js >= 22.13. pnpm is the only supported package manager, and
[corepack](https://nodejs.org/api/corepack.html) (built into Node.js) installs
the pinned version for you:

```bash
corepack enable   # once
pnpm install
```

## Common commands

Run everything from the repo root — [Turbo](https://turbo.build/) orchestrates
across workspaces:

| Command          | Description                                          |
| ---------------- | ---------------------------------------------------- |
| `pnpm dev`       | Start dev servers (inspect on :5173, scout on :5174) |
| `pnpm build`     | Build all workspaces                                 |
| `pnpm test`      | Run unit/integration tests (vitest)                  |
| `pnpm e2e`       | Run Playwright e2e tests                             |
| `pnpm check`     | Lint, typecheck, format check, manypkg check         |
| `pnpm lint`      | Lint only                                            |
| `pnpm typecheck` | Typecheck only                                       |
| `pnpm format`    | Format with Prettier                                 |

Scope any of these to one workspace with `--filter`:

```bash
pnpm --filter scout dev
pnpm --filter @meridianlabs/log-viewer test
pnpm --filter @tsmono/inspect-common typecheck
```

Workspace scripts are single-concern leaf commands; all composition lives in
`turbo.json` — see [scripts.md](docs/scripts.md) for the conventions.

## Workspaces

| Workspace                                              | Purpose                                                                                                       |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| [`apps/inspect`](apps/inspect/README.md)               | Inspect log viewer — runs standalone, statically hosted, in VS Code, or embedded via `@meridianlabs/log-viewer` |
| [`apps/scout`](apps/scout/README.md)                   | Inspect Scout viewer — browse scans, scanner results, and transcripts                                          |
| [`packages/inspect-common`](packages/inspect-common)   | Shared non-UI code for eval logs: generated API types, boundary normalization, query builder, test fixtures    |
| [`packages/inspect-components`](packages/inspect-components) | Shared React components for rendering eval logs (chat, transcript, content, usage, …)                    |
| [`packages/scout-components`](packages/scout-components) | React components shared across Scout surfaces                                                                |
| [`packages/react`](packages/react)                     | Shared React infrastructure: hooks, components, icons, virtualization, react-query helpers                     |
| [`packages/theme`](packages/theme)                     | Theme layer bridging Bootstrap tokens and VS Code webview variables                                            |
| [`packages/util`](packages/util)                       | General TypeScript utilities (barrel export — import from the package root)                                    |
| [`packages/zustand-devtools`](packages/zustand-devtools) | Dev panel for inspecting zustand stores                                                                      |
| `tooling/*`                                            | Shared eslint, prettier, tsconfig, and vite configs                                                            |

## Generated types

API types are generated from OpenAPI schemas exported by the Python repos —
no schema copies are committed here:

- **`apps/scout`** generates from inspect_scout's `openapi.json`
- **`packages/inspect-common`** generates from inspect_ai's
  `inspect-openapi.json`

Run `pnpm types:generate` in the relevant workspace after the Python API
changes. Each workspace's README documents its pipeline; the parent repos' CI
validates that committed schemas and generated types stay in sync.

## Documentation

- [Submodule guide](docs/submodule-guide.md) — developing inside a parent repo
- [Script conventions](docs/scripts.md) — Turbo orchestration and workspace scripts
- [AGENTS.md](AGENTS.md) — code style, testing, and type-safety conventions
  (written for coding agents; the rules apply to humans too)
- Design docs live per-app:
  - [Viewer startup/data-layer domain ownership](apps/inspect/design/domain-ownership.md) (inspect)
  - [Frontend testing: integration tests + MSW](apps/scout/design/front-end-testing.md) (scout)
  - [React Query patterns](apps/scout/design/react-query.md) (scout)
