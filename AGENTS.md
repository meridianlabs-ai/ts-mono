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

## Code Style — Type Safety

  Value type safety; avoid casts. `as` (and especially `as unknown as`)
  silences exactly the errors the compiler exists to catch — in tests and
  mock data too. Instead:
  - Build fixtures that genuinely satisfy the real types
  - When a function truly takes untrusted input (e.g. persisted state),
    type the parameter `unknown` and narrow with a type guard — don't cast
    the test data to lie about it
  - A cast is a last resort for boundaries TypeScript can't express, with
    a comment saying why

## Code Style — Comments                                                       
                                                                                
  Add comments only for non-obvious decisions:                                  
  - WHY a choice was made (not WHAT the code does)                              
  - Hidden constraints, performance tradeoffs, or known gotchas                 
  - Workarounds for specific bugs                        
                                                                                
  Skip comments that narrate the code. Good names already say what.             
  No multi-line comment blocks; no "this function does X" headers — use         
  docstrings only on public APIs.       