# Goal: subsystem directories — make the ownership map structural

## Intent (north star)

The two subsystems from [domain-ownership.md](domain-ownership.md) — **app
configuration** and **log-data acquisition** — each get their own directory,
peer to `state/`, so the subsystem boundary is visible in the file tree
instead of documented prose over a scattered layout. A pure mechanical move:
`git mv` + import updates, zero behavior change, zero renames of symbols.
After this goal, "interior never imported from outside" is a greppable
directory rule, not a policed convention.

Each subsystem dir gets a **barrel (`index.ts`) that exports only the public
surface** — this is the contract, not a convenience re-export. It fixes a
standing smell: symbols marked `export` solely so tests can import them read
as public today; once tests live inside the subsystem dir and import modules
directly, a module-level `export` is subsystem-private, and *public* means
exactly "exported from the barrel".

`state/` shrinks toward what domain-ownership.md says actually lives there:
UI-state slices, the react-query medium (`logsContent`, `queryClient`),
selected-log lifecycle, sample-level boundary code, and the composition root.

## Scope

IN:

- Create `src/app_config/` and `src/log_data/` (peers of `src/state/`).
- **Move into `app_config/`** (surface + interior per the ownership doc):
  - `app/appConfig.ts` + `app/appConfig.test.ts`
  - `app/urlLogSource.ts` + `app/urlLogSource.test.ts`
  - `app/singleFileMode.ts` + `app/singleFileMode.test.ts`
  - `app/server/useAppConfig.ts` + `app/server/useAppConfig.test.tsx`
  - `app/server/useLogDir.ts`
  - `client/api/index.ts` → `app_config/resolveApi.ts` (+ its test): its sole
    export is `resolveApi`, the "backend selection" interior concern. The api
    *implementations* (`client/api/view-server/`, `static-http/`, `vscode/`,
    `types.ts`, `client-api.ts`) stay put — they are the client layer, not
    config.
- **Move into `log_data/`** (surface + interior per the ownership doc):
  - `state/replicationControl.ts`
  - `state/fetchEngine.ts` + `state/fetchEngine.test.ts`
  - `state/databaseServiceInstance.ts`
  - `state/sync/replicationService.ts` → `log_data/replicationService.ts`
    (the `sync/` dir dissolves)
  - `state/useFetchEngineStatus.ts`
  - `state/useLogsSync.ts`
- Update all import specifiers (including test files); nothing else in the
  moved files changes.
- Per-subsystem `index.ts` barrel exporting **only the public surface** (the
  surface domain-ownership.md names; rubric decides exact shape). All
  external importers go through the barrel; interior modules and in-dir tests
  import each other directly. Symbols currently `export`ed only so tests can
  reach them do **not** appear in the barrel — they become subsystem-private
  by construction (a follow-up may then demote them from module exports
  entirely; noting candidates is in scope, changing them is not).
- Update module paths in [domain-ownership.md](domain-ownership.md) (and any
  other design doc that names a moved path).

OUT:

- Selected-log lifecycle (`state/selectedLogDetails.ts`,
  `state/pendingSamples.ts`, `LogLoadController`) — stays in `state/`.
- The medium: `state/logsContent.ts`, `state/queryClient.ts` — two-sided by
  design, belongs to neither subsystem.
- Sample-level boundary code (`state/samplePolling*.ts`, `useLoadSample`,
  `usePollSample`) — standing exception, stays.
- Zustand slices, `state/hooks.ts` (event-handler seam), `state/store.ts`
  (composition root) — stay; store's imports update only.
- Any refactor of the moved code: no signature changes, no splitting or
  merging modules beyond the `resolveApi` rename, no new abstractions.

## Done when (all must hold)

- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`, and
  `pnpm exec playwright test --config playwright.config.ts top-level-views.spec.ts`
  all green (from `apps/inspect`).
- Moves are pure renames: `git log --follow` works on every moved file; the
  diff outside moved files is import specifiers (and doc paths) only.
- Structural invariants (greppable, scoped to `apps/inspect/src`):
  - Old paths dead: zero matches for `state/fetchEngine`,
    `state/replicationControl`, `state/sync/`, `state/databaseServiceInstance`,
    `state/useFetchEngineStatus`, `state/useLogsSync`, `app/appConfig`,
    `app/urlLogSource`, `app/singleFileMode`, `app/server/useAppConfig`,
    `app/server/useLogDir` in import specifiers.
  - Interior stays interior: `replicationService` and
    `databaseServiceInstance` imported only from within `src/log_data/`
    (composition-root init in `store.ts` exempt, per the ownership doc);
    `urlLogSource`, `singleFileMode`, `resolveApi` imported only from within
    `src/app_config/` (composition roots `main.tsx` / `store.ts` exempt).
  - Surface honored: every import of a subsystem from outside its dir
    resolves to the barrel — zero deep imports (`app_config/…`/`log_data/…`
    past `index`) from external modules, composition roots included.
  - The barrel exports only what an external module actually consumes plus
    the surface the ownership doc names; nothing lands in a barrel "for
    tests".
- domain-ownership.md reflects the new paths and says nothing new — same map,
  new addresses.
- Behavior parity by construction (imports-only change); call out anything
  that turned out not to be import-only.

## Decision rubric (decide yourself — see Autonomy)

- **Move, don't improve**: any "while I'm here" cleanup is out of scope —
  note it for a future goal instead.
- **Barrel shape**: export exactly the surface domain-ownership.md names;
  when unsure whether something is surface, it isn't — widen later if a
  consumer genuinely needs it.
- **Import style**: match whatever the file's neighbors already do (relative
  specifiers); don't introduce path aliases in this goal.
- **File naming**: keep existing file names; only `index.ts → resolveApi.ts`
  and the `sync/` flattening rename anything.
- **Tests**: the suite is the safety net — no new tests needed for a pure
  move; keep it green each phase.

## Suggested phasing (adjust as discovered)

1. `app_config/`: git mv the six modules (+ tests), fix imports, barrel,
   green, commit.
2. `log_data/`: git mv the six modules (+ tests), fix imports, barrel, green,
   commit.
3. Doc updates (domain-ownership.md paths, any other doc naming moved files),
   commit.

Commit per phase; never commit red.

## Guardrails (must not break)

- Commit in the **ts-mono submodule** only; never touch the submodule gitlink
  or the parent `inspect_ai` repo. **Always ask before pushing.**
- Zero behavior change — if a move forces a code change beyond an import
  specifier, stop and surface it.
- Don't disable static-analysis warnings without discussing.

## Autonomy contract (HIGH)

- Proceed without asking on anything the rubric covers — barrel contents,
  import fixups, phase order, doc wording.
- Surface only: (a) a move that turns out not to be import-only, (b) a
  circular-import knot the move exposes, (c) scope creep, (d) before pushing.

## Current state (branch `loglist-tanstack-phase1`, ts-mono submodule)

- Latest commit `28923647` (pending samples out of zustand); tree clean.
- The ownership map is current as of that commit; all module paths in
  domain-ownership.md are the pre-move addresses listed under Scope.
- Import fan-out (informational): ~40 files import the app-config surface,
  ~17 the log-data surface — all mechanical specifier updates.

## Decisions

1. Dir names: `app_config`/`log_data` as specified (repo kebab-case
   convention noted; user-specified names kept).
2. `client/api/index.ts` moved to `app_config/resolveApi.ts`; the client api
   implementations stay in `client/api/`.
3. External *test* files may deep-import interior modules (test seams, not
   consumers); the one instance is `state/samplePolling.test.ts` →
   `app_config/appConfig` (`initAppConfig`, a module-export demotion
   candidate alongside `openLogDirDatabase` and `getAbsLogDir`).
