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

## Before you push

Run `pnpm check` from the repo root before every push or PR. It runs the
deterministic gates CI runs — manypkg, suppressions ledger, lint,
typecheck, format — so CI doesn't false-start on failures you could have
caught locally. If you changed code, also run `pnpm test`.

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

  **This is lint-enforced.** `@typescript-eslint/no-unsafe-type-assertion`
  errors on every assertion that isn't a provably-safe widening — narrowing
  (`raw as Event`), sideways, and every `as unknown as T` — and
  `consistent-type-assertions` rejects `{ ... } as T` object literals, where
  `satisfies T` checks the literal instead of asserting over it. Neither has
  an autofix; the fix is a type guard, a discriminant check, a real fixture,
  or `satisfies`.

  A cast that is genuinely a boundary keeps an
  `eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion --`
  directive naming the boundary (see the normalizer's `boundary lift (#555)`
  directives for the pattern). There is no repo-wide backlog to add to: the
  ~80 directives that remain each name a distinct surface. When the same
  cast would repeat across an untyped boundary, funnel it through one
  documented helper rather than per call site (see `asResponse` in the
  view-server client, `arrowCells.ts` and `formEvents.ts` in scout).

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

## Code Style — Void-Returning Handlers

  A function whose contract is to return void and that handles its own
  errors should be declared `(): void`, not `async`/`Promise<void>`. Do
  the async work and its error handling inside the function (a promise
  chain ending in `.catch`, or an inner async function whose rejection
  the sync wrapper catches) so it can never reject to the caller. Do not
  return a promise the caller is expected to drop.

  - Call sites stay clean (`onClick={handleSave}`, `setInterval(poll, ...)`)
    with no `() => void handleSave()` wrapper and no
    `no-floating-promises` suppression.
  - `no-floating-promises` runs with `ignoreVoid: false` here, so a
    `void`-prefixed drop is deliberately not an accepted escape.
  - Keep a function `async` only when some caller genuinely awaits it;
    a fire-and-forget call site then carries a reasoned suppression
    naming that caller (see the `_throttledUpdateDbStats` directive in
    `fetchEngine.ts`).

## Suppression gate

- Do NOT suppress lint or type errors. Fix the code. See
  [CONTRIBUTING.md](CONTRIBUTING.md); a deterministic gate enforces this
  (`pnpm suppressions:check` against `suppressions.json`). Maintainers
  reject suppressions that just make an error go away.
- In the rare case a suppression is correct (`@ts-ignore` and
  `@ts-nocheck` are banned outright), it requires both: an explicit
  `-- reason` in the comment, and `pnpm suppressions:update` to record it
  in `suppressions.json`.
- Every new suppression requires human maintainer approval of the
  `suppressions.json` diff; expect the PR to be blocked until then, and
  say in the PR description why no fix is possible.
- If the `suppressions` CI check fails, never hand-edit the ledger to make
  it pass. Run `pnpm suppressions:update` so the change shows in the
  ledger diff.

## Code Style — React Compiler & Memoization

  **React Compiler is enabled** in both apps' vite builds (SWC
  `reactCompiler`, see #536). It auto-memoizes components and hooks, so
  manual memoization is dead weight in new code:

  - Do NOT write `useMemo`, `useCallback`, or `React.memo` for
    performance. Write plain functions and values; the compiler inserts
    memoization finer-grained than hand-written deps arrays.
  - Much existing code predates the compiler and memoizes everything —
    do not copy that style into new code.
  - The remaining legitimate use is referential identity as a
    *correctness* requirement TypeScript/compiler can't see (e.g. a
    render-time cache like `useKeyedMemo`/`useStableValue`, marked
    `"use no memo"`). Those carry a comment saying why.
  - The compiler bails out per-function; in a bailed-out component,
    existing manual memoization is load-bearing. Don't bulk-strip
    `useMemo`/`useCallback` from code you aren't otherwise changing, and
    before removing it from a component you are changing, confirm the
    component compiles (React DevTools shows a ✨ badge; the
    `react-hooks` ESLint rules flag most bail-out causes).
  - Unsupported syntax anywhere in a component/hook body bails out the
    whole function — keep gnarly imperative code (`try/finally`,
    mutation-heavy loops, `for await`) in module-level helpers instead
    of inline in the component.
  - Vitest runs uncompiled code (the SWC plugin is vite-only); only e2e
    and the real apps exercise compiled output.

## Code Style — Effects

  **Raw `useEffect`/`useLayoutEffect` is lint-banned**
  (`tsmono/no-raw-use-effect`). A raw effect makes the reader reconstruct
  timing, deps, and cleanup to learn what it is for; a hook named for the
  scenario states it. Instead:

  - **Reach for a named hook from `@tsmono/react/hooks`.** The scenario →
    hook mapping: DOM events → `useEventListener`; dismiss-on-outside-press
    → `useOnClickOutside`; timers → `useInterval` / `useTimeout` /
    `useRafThrottle`; one-time mount setup/teardown → `useMountEffect`;
    unmount-only cleanup → `useUnmount`; "mirror the latest value into a
    ref" → `useLatestRef`; element size → `useResizeObserver` /
    `useElementHeight`; document title → `useDocumentTitle`; debounce →
    `useDebouncedCallback`; scroll tracking → `useScrollDirection` /
    `useScrollTrack` / `useStatefulScrollPosition`.
  - **Most effects shouldn't become a hook at all.** Setting state in
    response to a prop/state change is the anti-pattern from
    [react.dev/learn/you-might-not-need-an-effect](https://react.dev/learn/you-might-not-need-an-effect):
    derive the value during render, reset with a `key`, or move the logic
    into the event handler. Data fetching belongs in React Query, not an
    effect.
  - **The one place raw effects are allowed** is the wrapper
    implementations themselves, `packages/react/src/hooks/**`. A genuinely
    new effect scenario gets a new named hook there (with tests), not a
    suppression at the call site.
  - Existing call sites were baselined with
    `eslint-disable-next-line tsmono/no-raw-use-effect -- baselined ...`
    suppressions. When you touch one, prefer migrating it to a named hook
    or derived state and deleting the suppression; never copy the
    suppression pattern into new code.

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
