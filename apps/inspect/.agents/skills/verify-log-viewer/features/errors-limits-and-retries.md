# Errors, limits, and retries

Failure and partial-outcome surfaces across logs and samples: task errors,
sample traceback, cancelled runs, sample limits and reasons, model fallbacks,
retry attempt cards, terminal outcome, and error/limit columns.

## Sub-features

- `log-error` adds an Error workspace tab and error status/header treatment.
- `sample-error` adds an Error tab and summary error block for the terminal
  sample failure.
- `sample-limit` shows the limit kind and why it fired from sample-summary data.
- `sample-retries` renders each retry attempt with cause, events/attachments,
  duration, and the final success/error/limit/cancelled anchor.
- `list-failure-columns` promotes error/limit/retries/fallback columns when any
  row has data.
- `cancelled-partial` keeps completed samples/results visible while marking the
  run or sample cancelled.

## How to get to it (user POV)

- Open an errored or cancelled log and inspect header, Samples, and Error.
- Open a failed/limited/retried sample. Error and Retries tabs appear only when
  their data exists; summary badges/fields remain visible above all tabs.
- Use Tasks/Samples columns to locate failures across many rows.

## Driving it with Playwright

- Log error: use the documented viewer-error fixture; assert error status,
  Error tab, message, and traceback/ANSI output.
- Sample error/limit: assert the summary and dedicated tab agree on the
  terminal outcome and fixture-specific reason.
- Retries: assert attempts in chronological order, expand one card, verify its
  error/events/attachments, and assert the terminal anchor reflects the final
  run outcome rather than the last retry alone.
- Cancelled run: assert completed samples remain navigable and the cancelled
  count/status is visible.
- Cross-check list columns against detail, then screenshot both surfaces.

## Code landmarks

- Log error/status: `apps/inspect/src/app/log-view/tabs/ErrorTab.tsx`,
  `log-view/error/TaskErrorPanel.tsx`, and `log-view/title-view/StatusPanel.tsx`.
- Sample summary/error/limit: `apps/inspect/src/app/samples/SampleSummaryView.tsx`,
  `samples/error/`, and `samples/status/`.
- Retry UI/derivation: `apps/inspect/src/app/samples/SampleRetriedErrors.tsx`,
  `apps/inspect/src/app/samples/retry-display/`, especially `retryAttempt.ts`.
- Grid fields: `apps/inspect/src/app/shared/samples-grid/columns.tsx` and
  log-list column hooks.
- Regression coverage: retry-display tests, SampleRetriedErrors tests,
  sampleUtils tests, `apps/inspect/e2e/error-state.spec.ts`, and relevant
  transcript attachment tests.

## Gotchas

- Retrieval errors are not eval errors. A failed `/api` request belongs to
  `loading-live-refresh.md`; an `EvalError` inside a loaded log belongs here.
- A run can error after producing samples and scores. Preserve partial data.
- The effective config (including mid-run `continue_on_fail`) changes which
  results/status combination is correct.
- Limit text must come from the summary so it is available before the full
  sample body; fetching the body to render the badge regresses list/detail load.
- Retry-event attachments belong to the attempt that produced them. Avoid
  flattening attempts into one undifferentiated transcript.
