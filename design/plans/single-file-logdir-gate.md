# Single-file logDir gate — make `logDir` non-nullable

## Goal

Kill the `logDir ?? ""` sentinel + `string | undefined` plumbing. Both loader hosts
resolve `logDir` before rendering children → consumers below the gate get a defined dir.

## Root cause

`logDir` derived from the raw file ref (bare basename → `dirname` = `""`), not the
file's resolved location. Location is never unknown: relative resolves against
`document.baseURI` (= static's `currentDirUrl`), view-server/VS Code give absolute paths.

## Resolver (always defined) — `app/singleFileMode.ts`

`resolveSingleFileLogDir(fileRef, api): Promise<string>`:

1. `dirname(fileRef)` if non-empty.
2. else `await api.get_log_dir?.()` if set.
3. else `dirname(new URL(fileRef, document.baseURI).href)` (page floor; always non-empty).

Frontend-only: no backend learns to return a dir.

## Invariant

`LoaderHost` children render only after `["log-dir"]` is populated.

- Dir mode: `DirectoryLoaderHost` already gates + asserts `log_dir`.
- Single-file: `SingleFileLoaderHost` becomes a gate. URL-param paths resolve+`setLogDir`
  themselves (loading until done); embedded/VS Code keeps `App.onMessage` seeding (hardened
  to always seed defined: `isUri ? dirname : page-floor`), host just waits on `useMaybeLogDir`.

Past the gate → `useLogDir(): string` sound everywhere below.

## Phases (done)

1. **Resolver + gate.** Added resolver; removed `deriveSingleFileLogDir`.
   `SingleFileLoaderHost` gates the `?log_file=` bootstrap. `App` embedded seed
   hardened. `setLogDir(logDir: string)`.
2. **Retired `initLogDir`** from zustand + its callers (`useLoadLog`, `LogViewContainer`,
   `LogSampleDetailView`, `SamplePrintView`, host) + `loadLog` fallback.
3. **Moved the above-gate orchestrator below the gate.** `App`/`AppContent` used to own
   log-load + running-log poll (reading `useSelectedLogDetails` above the gate), which
   forced the whole reader chain nullable. Extracted to `<LogLoadController>`, rendered by
   both hosts below the gate. `App` keeps only `useMaybeLogDir` for its host-message
   comparison.
4. **Collapsed the type.** `logsContent` keys/seam take `string` (no `?? ""`); readers
   (`useLogHandles`/`useLogPreviews`/`useLogDetails`/`useLogDetail`) take `string`;
   `useSelectedLogDetails` + all below-gate callers use `useLogDir()`. Non-React readers
   still guard honestly (`getLogDetail`→`undefined`, never a `""` bucket).

`useMaybeLogDir` now survives only where a dir may genuinely be unresolved: the
`SingleFileLoaderHost` gate, `App`'s host-message bridge, and the pre-existing
navigation/url callers that opted into nullable-tolerance.

## Not in scope

`get_log_dir_handle`'s `"default_log_dir"` (dir-mode IndexedDB name; separate concern).

## Risks

- **Manual test:** `?log_file=`, VS Code embed — not e2e-covered (dir-mode
  e2e is green).
- VS Code URLs assumed absolute (`dirname` works; page-floor fallback).
- `useLogDir()` throws above the gate — nothing above it reads it now (`App` uses
  `useMaybeLogDir`).
