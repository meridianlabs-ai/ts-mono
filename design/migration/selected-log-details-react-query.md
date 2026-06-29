# Opened-log details → react-query

Follow-on to `loglist-content-react-query.md` / `loglist-content-zustand-extraction.md`.
Those moved the log-list **collection** (handles/previews/details) into react-query.
This plan removes the last duplicate of that data: `log.selectedLogDetails`, the
zustand copy of the *opened* log's `LogDetails`, so the opened log reads from the
same `["log-details", logDir]` cache the listing already owns.

## Phase 0 — done

The log-list cache is split into three keys (`["log-handles" | "log-previews" |
"log-details", logDir]`), and `logsContent` is the sole writer of IndexedDB:
every `write*`/`clear*` seam fn pairs the IndexedDB write with its cache write
(invariant: **db write ⟹ cache write**). `loadLog` now mirrors the opened log's
details into the details cache via `logsContent.writeDetail`.

## Phase 1 — retire `log.selectedLogDetails` — done

Implemented and verified (449 unit + 55 e2e green). `log.selectedLogDetails`,
`setSelectedLogDetails`, and `clearSelectedLogDetails` are gone; readers use
`useSelectedLogDetails()` (settled `LogDetails | undefined`, built on
`useLogDetail`); `loadLog`/`refreshLog`/`logPolling` write the opened log into
the details cache (loadLog persists via the seam, polling is cache-only); the
dead persist filter (`filterLargeLogDetails`/`filterState`) is removed.

The design below is what shipped.

### The hook
`useLogDetail(logFile): AsyncData<LogDetails>` in `logsContent.ts`, composing the
`["log-details", logDir]` collection:
- resolve `logFile` → the row by `handle.name.endsWith(logFile)` (same resolution
  as `getSelectedLog`), then read `details[handle.name]`;
- row present → `data(details[key])`; row absent → `loading`; **error branch is
  written but unreachable** — the passive cache has no fetch-error source today
  (see open question). `AsyncData` requires the branch regardless.

A non-React `getLogDetail(logFile)` accessor for slice/polling call sites.

### Key unification (prerequisite)
The opened-log detail must be keyed the same as the listing (`handle.name`,
absolute) so the hook finds it:
- `loadLog` uncached path keys by the raw `logFileName` (often relative) while the
  cached-refresh path keys by `logAbsPath`. Unify on the resolved absolute key.
- `logPolling.refreshLog` writes the refreshed details into `selectedLogDetails`;
  reroute to `logsContent.writeDetail(db, logDir, key, details)` under the same key.

### Consumer migration (~15 sites)
Group and verify after each:
1. **Eval-spec/header readers** (`LogView`, `SamplesTab`, `SampleSummaryView`,
   `SampleDisplay`, `SamplePrintView`, `SampleList`, `useSamplesView`, `TagStrip`,
   `hooks.ts` `useEvalSpec`/scores/`useLogStatus`) — swap
   `useStore(s => s.log.selectedLogDetails…)` for `useLogDetail(selectedLogFile)`.
2. **Scores** (`hooks.ts` `useAvailableScores` etc.) derive from the same; re-source.
3. **Polling** (`logPolling`, `samplePolling`) — read via `getLogDetail`, write via
   the seam.
4. **Persist** (`store_filter.ts` `filterLargeLogDetails`) — delete; react-query
   isn't persisted, so the opened log reloads from IndexedDB/server. Drop the dead
   `isLargeSample` too.
5. Remove `selectedLogDetails` from `LogState`, delete `setSelectedLogDetails` /
   `clearSelectedLogDetails` and their callers.

## TODO (follow-on, not Phase 1)

- **Loading-state source.** The running-log poll trigger and the load-guard
  moved out of `App` (above the loader gate) into `<LogLoadController>` below it
  (see `design/plans/single-file-logdir-gate.md`), so they now read
  `useSelectedLogDetails` where the dir is resolved. Still open: `app.status.loading`
  is driven imperatively via `setLoading` rather than derived from the query's
  `AsyncData`. Also the route-change **stale-flash guard** (formerly
  `clearSelectedLogDetails` in `LogViewContainer`) — gate render on the query
  settling for the new file.

## Open question

- **Error channel.** The details collection is a passive cache with no error
  source, so `useLogDetail`'s error branch is currently unreachable. When a real
  on-demand fetch-error path exists, surface it (per-file error map, or fold the
  fetch into the hook). Until then, absent ⇒ loading.
