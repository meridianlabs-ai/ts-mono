# ts-mono

TypeScript monorepo sharing code between inspect_ai, inspect_scout, vs code extension, etc.

## Documentation

Design docs live per-app; consult them when working in the relevant area:

- [Viewer startup/data-layer domain ownership](apps/inspect/design/domain-ownership.md) (inspect)
- [Frontend testing: integration tests + MSW](apps/scout/design/front-end-testing.md) (scout)
- [React Query patterns: queryOptions, skipToken](apps/scout/design/react-query.md) (scout)

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

  **Parsed data is normalized at the boundary (#555).** Eval-log and
  journal JSON is written by many inspect_ai versions: old files omit
  fields the generated types declare required (pydantic fills them at
  read time on the Python side). Every raw parse of such data must run
  through `@tsmono/inspect-common/normalize` (`normalizeEvalSample`,
  `normalizeEvents`, `normalizeEvalSpec`, `normalizeSampleSummary`, ...) —
  the chokepoints in `remoteLogFile.ts` (samples and summaries),
  `resolveSample`, `static-http/fetch.ts`, the pending-samples transport,
  and the scout event ingestion already do. Downstream of those, trust the
  types: no defensive `?.` on normalized data. When a new
  required-with-default field lands in the schema, add the matching fill to
  the normalizer (mirroring pydantic's default), not a guard at the read
  site.

  Surfaces NOT yet normalized still carry `#555` suppressions and keep
  their guards: API responses and persisted webview/store state. Do not
  remove those guards until their boundary normalizes; the suppression
  comment names the surface.

## Code Style — Comments                                                       
                                                                                
  Add comments only for non-obvious decisions:                                  
  - WHY a choice was made (not WHAT the code does)                              
  - Hidden constraints, performance tradeoffs, or known gotchas                 
  - Workarounds for specific bugs                        
                                                                                
  Skip comments that narrate the code. Good names already say what.             
  No multi-line comment blocks; no "this function does X" headers — use         
  docstrings only on public APIs.

## Testing

- Test observable behavior, not implementation details — tests shouldn't
  break on refactors or minor DOM restructuring
- Don't test what the type system already enforces
- Prefer integration tests over heavily-mocked unit tests; mock at the
  network level (MSW), not internal modules — see
  [front-end-testing.md](apps/scout/design/front-end-testing.md)
- Tests must be isolated and deterministic; no shared mutable state or
  order dependencies
- **Fixture placement**: builders for a package's public types live in that
  package's testing subpath export — `@tsmono/inspect-common/testing`,
  `@tsmono/react/testing`, `@tsmono/inspect-components/transcript/test-helpers`.
  Builders for app-private types stay in the app (e.g.
  `apps/scout/src/test/objectFactories.ts`,
  `apps/inspect/src/log_data/testFixtures.ts`). Thin test-local wrappers
  that parameterize a shared builder (fixed timestamps, positional args)
  are fine; a test file re-declaring the field list of a shared type is
  the sign the builder belongs upstream. Production code never imports
  from a testing export.

## Pull Requests

- For changes that affect UI appearance (styles, layout, theming, CSS
  refactors), include before/after screenshots in the PR description —
  both light and dark themes when the change touches themed surfaces.
  A visual diff catches regressions review of the CSS alone won't.
