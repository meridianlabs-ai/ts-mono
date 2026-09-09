# Evaluation info

The log workspace's Info tab: a high-level Summary of dataset, solvers, and
scorers plus the evaluation metadata record tree and oversized-log warning.

## Sub-features

- `info-summary` shows dataset, solver steps, and scorer names/parameters.
- `info-metadata` renders arbitrary nested evaluation metadata with collapse,
  copy, and optional editing.
- `info-large-log-warning` explains when a successful log declares samples
  but none can be displayed because the log is too large.

## How to get to it (user POV)

- Open a log and choose the `Info` workspace tab.
- Expand solver/scorer details or nested metadata rows.
- When editing is supported, choose Edit in the Metadata card.

## Driving it with Playwright

- Deep-link to `/#/logs/<file>/info`; assert the Info tab is selected and the
  Summary card contains fixture-specific dataset/solver/scorer text.
- Assert nested metadata values, collapse and expand a record, and copy one
  known leaf. For a large metadata fixture, scroll beyond the initial window.
- Edit metadata only with an editable fixture: cover add/remove/change,
  cancel, invalid JSON for non-string values, save, and reload persistence.
- Prove the large-log warning only with a log whose dataset count is positive
  while the loaded sample count is zero.

## Code landmarks

- Tab and warning: `apps/inspect/src/app/log-view/tabs/InfoTab.tsx`.
- Summary/metadata cards: `apps/inspect/src/app/plan/PlanCard.tsx` and the
  dataset/solver/scorer views in `apps/inspect/src/app/plan/`.
- Record rendering: `packages/inspect-components/src/content/RecordTree.tsx`
  and `MetaDataGrid.tsx`.
- Metadata editor: `apps/inspect/src/app/log-view/title-view/EditMetadataDialog.tsx`.
- Regression coverage: `apps/inspect/e2e/metadata-record-tree.spec.ts`,
  `EditMetadataDialog.test.tsx`, and RecordTree component tests.

## Gotchas

- `Info` is the visible label but its historical internal tab id is `info`;
  older code may call the descriptor variable `config`.
- Metadata can be any JSON shape and is virtualized when large. DOM row counts
  and nth-child selectors are unreliable.
- A missing Metadata card can be correct when metadata is empty and the host
  does not expose editing.
- The oversized-log warning is about unavailable samples, not a generic API
  failure; listing/detail errors use the surfaces in `loading-live-refresh.md`.
