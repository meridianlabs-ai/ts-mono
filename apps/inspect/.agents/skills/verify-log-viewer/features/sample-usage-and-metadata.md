# Sample usage and metadata

The conditional Usage tab and always-addressable Metadata tab in sample
detail: model/role timing, token and cost breakdowns, working/total time, and
arbitrary nested sample metadata/store/provenance.

## Sub-features

- `sample-usage` shows per-sample model usage, role aliases, configs/args,
  timing, and cost when the log records them.
- `sample-metadata` renders sample metadata, store, and provenance as nested
  records with copy and collapse controls.
- `sample-metadata-empty` shows an explicit empty state when none exists.
- `sample-record-virtualization` keeps very large trees scrollable and usable
  across tab switches.

## How to get to it (user POV)

- Open a sample. `Usage` appears only when at least one usage view has data.
- Choose `Metadata` for the record trees; expand/collapse nodes and use copy
  controls on values.

## Driving it with Playwright

- Usage: select `#usage-contents` on a fixture that records usage; assert exact
  model/role names, token counts, time, and cost. If the tab is absent, confirm
  the fixture has no usage before reporting a bug.
- Metadata: select `#metadata-contents`; assert a known nested key/value,
  collapse/expand it, and verify a copy action.
- Empty: use a fixture with no metadata and assert `No sample metadata available`.
- Large tree: scroll to a leaf beyond the initial virtual window, switch tabs
  away/back, and assert the tree still expands and scrolls correctly.

## Code landmarks

- Tab construction and data shaping: `apps/inspect/src/app/samples/SampleDisplay.tsx`
  (`usageViewsForSample`, `metadataViewsForSample`).
- Shared usage: `packages/inspect-components/src/usage/`.
- Record rendering: `packages/inspect-components/src/content/RecordTree.tsx`,
  `MetaDataGrid.tsx`, and record processors under `content/record_processors/`.
- Regression coverage: `apps/inspect/e2e/metadata-record-tree.spec.ts`, usage
  utility/component tests, and RecordTree tests.

## Gotchas

- Usage is conditional; Metadata is present even when empty.
- Token counts and cost can be absent independently. Do not coerce missing cost
  to zero or hide valid token data because cost is absent.
- `store` records can receive richer rendering in Transcript events while the
  Metadata tab remains a general tree. Match the screenshot's surface first.
- Record trees are virtualized and collapse large records by default. An
  offscreen leaf being absent from the DOM is not data loss.
