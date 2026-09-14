# Loading, live evals, and refresh

How log listings, details, sample summaries/bodies, messages, and transcript
events become available and stay current: boot gates, loading/error/empty
states, local IndexedDB, background detail fetching, polling/streaming,
pending samples, completion handoff, invalidation, and recovery.

## Sub-features

- `boot-listing` resolves app configuration/backend, opens the per-directory
  database, and syncs the collection before useful routes render.
- `listing-refresh` reconciles created/changed/deleted files, host refresh
  events, retried-log dedup, and scoped sample listings.
- `log-detail-load` shows cached detail immediately when safe, refreshes in the
  background, and clears stale content when selecting another log.
- `sample-load` resolves summaries and completed, chunked, pending, running,
  errored, or backfilling sample data without showing a prior sample.
- `live-sample` appends ordered messages/events, follows the tail, distinguishes
  Generating from Loading events, and hands off exactly once on completion.
- `load-errors-retry` shows an error rather than false empty state and recovers
  after a successful retry/invalidation.

## How to get to it (user POV)

- Launch into a directory, move rapidly between logs/samples, refresh, or
  watch a running evaluation produce samples and settle.
- Open Viewer Options to see cache counts or clear the isolated local database.
- Trigger an unavailable/renamed directory or backend error to see the loading
  bar, loading placeholder, ErrorPanel, and recovery.

## Driving it with Playwright

- Capture a trace of `/api/logs`, `/api/log-files`, `/api/log-headers`, log
  detail, sample, pending-sample, and client-event requests while asserting
  visible states. Avoid `networkidle`; live polling makes it meaningless.
- Delay one response: assert loading chrome appears without stale content from
  the previous identity, then the correct fixture content replaces it.
- Fail listing/detail/sample once, assert ErrorPanel and exact error, recover
  the boundary, invalidate/Retry, and assert data appears.
- Live fixture: assert ordered append, stable existing rows, follow behavior,
  progress placeholder, no duplicate `(id, epoch)` summary, and exactly one
  transition to settled content.
- Rename/delete a served directory and assert bounded retries/no fetch storm.

## Code landmarks

- Architecture contract: `apps/inspect/design/domain-ownership.md`.
- App/bootstrap configuration: `apps/inspect/src/app_config/` and composition
  in `apps/inspect/src/app/App.tsx`.
- Acquisition owner: `apps/inspect/src/log_data/`, especially
  `FetchEngineController.tsx`, `replicationControl.ts`, `fetchEngine.ts`,
  `listingSync.ts`, `sampleData.ts`, `sampleStream.ts`, `pendingSamples.ts`,
  `sampleMessages.ts`, and `imperativeLogData.ts`.
- Transport/normalization: `apps/inspect/src/client/api/`,
  `apps/inspect/src/client/remote/`, and
  `packages/inspect-common/src/normalize/`.
- Loading derivations and route selection: `apps/inspect/src/state/`,
  `apps/inspect/src/app/routing/loaders/`, and log/sample view containers.
- Regression coverage: `apps/inspect/e2e/error-state.spec.ts` plus the extensive
  tests in `apps/inspect/src/log_data/`, `client/api/`, `client/remote/`, and
  routing loaders.

## Gotchas

- Retrieval failure and eval failure are different: acquisition errors are
  transport state; `EvalError` is successfully loaded log data.
- The acquisition subsystem is the only owner allowed to read log data from
  the backend. UI fixes should subscribe/invalidate, not add a fetch effect.
- App config binds one API instance to one log directory. Changing directory
  rebuilds and activates a new snapshot; reusing the previous API is stale.
- Old eval-log versions omit fields current generated types require. Normalize
  at parse boundaries rather than scattering defensive UI guards.
- Running, chunked, and completed samples have different feeds behind one data
  hook. A renderer should not branch on transport mechanics.
- `loading`, `busy`, and `error` are derived. Imperatively setting a loading
  boolean usually creates stuck or under-counted states.
