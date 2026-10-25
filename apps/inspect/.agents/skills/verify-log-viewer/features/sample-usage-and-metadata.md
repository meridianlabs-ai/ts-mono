# Sample usage and metadata

The Info tab in sample detail (usage on top, then metadata; the legacy
`usage` and `metadata` tab ids route to it): model/role timing, token and cost breakdowns, working/total time, and
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

- Open a sample and choose `Info`. The usage panel appears first, only when
  the sample records usage; the metadata record trees follow. Expand/collapse
  nodes and use copy controls on values.

## Driving it with Playwright

- Usage: within `#info-contents` on a fixture that records usage, assert exact
  model/role names, token counts, time, and cost. If the usage panel is absent,
  confirm the fixture has no usage before reporting a bug.
- Metadata: within `#info-contents`, assert a known nested key/value,
  collapse/expand it, and verify a copy action.
- Empty: use a fixture with no usage or metadata and assert
  `No sample usage or metadata available`.
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

- The Info tab is always present; the usage panel within it is conditional.
- Token counts and cost can be absent independently. Do not coerce missing cost
  to zero or hide valid token data because cost is absent.
- `store` records can receive richer rendering in Transcript events while the
  Info tab remains a general tree. Match the screenshot's surface first.
- Record trees are virtualized and collapse large records by default. An
  offscreen leaf being absent from the DOM is not data loss.
