# Remaining effect debt — apps/inspect

`tsmono/no-raw-use-effect` blocks new raw effects, but the existing ones were
baselined with a generic suppression. The effects below are known to be the
wrong tool, measured against
[You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect).
Each entry names the file and the effect's purpose (line numbers drift), the
problem, and the intended fix. Delete an entry when its fix lands.

The original 2026-08 audit, including the items already fixed, is in git
history for this file.

## State mirrors

- `app/log-view/LogViewContainer.tsx`: URL `tabId` is mirrored into
  `tabs.workspace`. Fix: make the URL canonical and have clicks only navigate.
- `app/samples/SampleDetailComponent.tsx`: URL `tabId` is copied into the
  store's sample tab for store-only readers. Fix: the reader hook derives
  `urlTabId ?? storeTab`.
- `app/samples/transcript/TranscriptPanel.tsx`: the `initialEventId` prop is
  mirrored into `selectedOutlineId`. Fix: set it in the navigation handler that
  produces the deep link, or track the last-applied id during render.

## Derived or reset state written from effects

- `app/samples/SampleDisplay.tsx`: a sample with zero events forces the
  messages tab into the global store whenever `sample` identity changes, which
  can override the user's choice. Fix: the store holds "unset" until the user
  picks; derive the default during render.
- `app/samples/list/useSamplesView.ts`: newly seen columns are seeded into the
  store after render, so the first frame is unseeded. Fix: merge at render;
  persist only through user-action writers.
- `app/samples-panel/SamplesPanel.tsx`: compares `samplesPath` with the stored
  `previousSamplesPath` to clear `displayedSamples`. Fix: record the path
  alongside the samples in `setDisplayedSamples`, have consumers ignore a
  mismatched scope, and delete `previousSamplesPath`.
- `app/routing/loaders/SampleLoadController.tsx`: watches selection identity
  to drop per-sample UI bags. Fix: do the resets in the `selectSample` action
  (it already has an identity-changed branch) and delete the controller.
- `state/hooks.ts` `useMessageVisibility`: clears visibility on
  `selectedLogFile` / `selectedSampleHandle` change using a first-render ref,
  so remounted instances skip the clear and leak stale state. Fix: clear
  centrally in the `selectLogFile` / `selectSample` actions.

## Data flow

- `app/shared/samples-grid/SamplesGrid.tsx`: `onDisplayedRowsChange(items)`
  pushes shaped rows up to `SamplesPanel` and into zustand. Fix: lift the
  query/filter/sort shaping to the owner.
- `app/log-view/title-view/EditTagsDialog.tsx` and `EditMetadataDialog.tsx`:
  identical `get_user_info()` fetch-in-effect with a manual cancelled flag. Fix:
  a shared `useUserInfo()` React Query hook; derive the author as
  `edited ?? userInfo?.name ?? ""`.
- `log_data/log.ts` `useLogHeader`: fires the engine's `fetchLog` per mount
  alongside React Query, with no un-demand on unmount. Fix: fold demand into
  the query layer so React Query owns dedupe and lifecycle.
- `app/routing/loaders/LogLoadController.tsx`: "log settled" logic is driven
  by a `details_settled_seq` counter and a `demand` split. Fix: a completion
  callback or promise from the active `fetchLog` path that invokes a store
  action; delete the seq/demand plumbing.

## Open decision

- `app/log-list/LogsPanel.tsx` single-log redirect: the redirect renders
  `<Navigate replace>` but is not gated on the listing having settled, so a
  stale cache seeded with a single row could redirect. Gating on `sync.loading`
  delays warm-cache redirects by a full `syncLogs` round trip, and
  `useLogListing`'s `useDeferredValue` lets settled flags disagree with
  `logItems` for a frame, so a naive gate doesn't fully close the gap. The risk
  is theoretical so far.
