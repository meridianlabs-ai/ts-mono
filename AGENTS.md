# ts-mono

TypeScript monorepo sharing code between inspect_ai, inspect_scout, vs code extension, etc.

## Conventions

- **Consumed via git submodule** — see [submodule-guide.md](docs/submodule-guide.md)
  for setup, sync, and development workflows in parent repos
- **Turbo owns orchestration** — workspace scripts are single-concern leaf
  commands. See [scripts.md](docs/scripts.md) for details
- **pnpm only** — never npm or yarn
- **Workspace deps**: `"workspace:*"` protocol
- **`@tsmono/util`**: barrel export — import from the package, not individual files
- **Tooling defaults are fully strict** — new packages get strictest rules;
  legacy code (apps/scout, packages/util) relaxes via local overrides
