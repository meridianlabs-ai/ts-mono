# useEffect audit — apps/inspect

Audit of all `useEffect` usage against [You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect).

Current inventory (verified at `4df0a64`): **67 effects** in `apps/inspect` — 62 `useEffect` +
5 `useLayoutEffect` — of which **22 are open** items below and **45 are appropriate**. One further
open item (`## Latent bug, still open`) is a follow-up on an effect that no longer exists. Eleven
original findings plus four latent bugs have shipped (`## Shipped`); those effects are either gone
or now sit in the appropriate list.

Working doc: check items off (and note the commit) as fixes land.

**Items are cited by file + symbol, not line number.** The original audit's line refs were
keyed to a pre-fix tree and were already wrong the day the doc landed; don't reintroduce them.
Paths are relative to `apps/inspect/src/` (the `## Shipped` section keeps its as-audited refs).
Two components the first pass audited (`FindBand`, `AsciinemaPlayer`) now live in
`packages/react` and are out of this doc's scope.

React Compiler is enabled for both apps as of #536. It changes the calculus on a few notes here:
an effect that exists to dodge a compiler lint is a smell, and a store write during render is
worse than the effect that replaces it (see `useFilteredSamples` in the appropriate list).

## Themes

1. **URL ↔ zustand double-bookkeeping (`state-sync-mirror`)** — 8 open instances. Route params
   copied into `logs.selectedLogFile` / `selectedSampleHandle` / `tabs.workspace` / `tabs.sample`
   via effects so store-keyed data hooks fire. `SampleRouteSelectionController`'s docstring admits
   this is interim. Real fix: data hooks keyed on route params; store only for unrouted selection.
   One architecture change eliminates ~5 effects.
2. **Default seeding (`derived-state`)** — 2 open: `useSamplesView` (columns) and `TimelineTab`
   (sort direction). Two of the three column-visibility seeders the first pass found are fixed, as
   is `SampleDisplay`'s dock default. Each writes a computable default into a persisted store
   instead of merging at read time.
3. **routing/loaders effect chain** — route change → selection effect → reset effect → fetch effect
   → settle-seq effect, each link guarded by identity strings/seq counters/demand flags.
4. **`get_user_info()` fetch-in-effect** — duplicated in both edit dialogs; should be a shared
   react-query hook.

## Moderate

- [ ] `log-view/LogViewContainer.tsx` (initialState → `navigate`) — **event-logic-in-effect** —
      host-message → store `initialState` → effect → `navigate()`. Fix: `onMessage` navigates
      directly via the `AppRouter` singleton; delete slice field + effect.
- [ ] `log-view/LogViewContainer.tsx` (`setWorkspaceTab`) — **state-sync-mirror** — URL `tabId`
      mirrored into `tabs.workspace`. Fix: URL canonical; clicks only navigate.
- [ ] `log-view/tabs/SamplesTab.tsx` (single-summary `selectSample`) — **derived-state** —
      single-sample auto-select written to store. Fix: derive only-sample fallback in the selection
      hook or pass props to `InlineSampleDisplay`.
- [ ] `log-view/title-view/EditTagsDialog.tsx` (`get_user_info`) — **fetch-in-effect** — manual
      cancelled flag; refetches when `currentTags` changes. Fix: shared `useUserInfo()` react-query
      hook; derive author `edited ?? userInfo?.name ?? ""`.
- [ ] `log-view/title-view/EditMetadataDialog.tsx` (`get_user_info`) — **fetch-in-effect** —
      identical pattern, re-firing on `initialEntries`; fix together with EditTagsDialog.
- [ ] `shared/samples-grid/SamplesGrid.tsx` (`onDisplayedRowsChange`) — **pass-data-to-parent** —
      pushes shaped rows up to SamplesPanel → zustand. Fix: lift query/filter/sort shaping to the
      owner.
- [ ] `samples/SampleDisplay.tsx` (zero-event → messages tab) — **adjust-state-on-prop-change** —
      forces the messages tab into the global store per `sample` identity change; can fight the
      user. Fix: store holds "unset" until the user picks; derive the default in render.
- [ ] `samples/SampleDetailComponent.tsx` (`setSampleTab`) — **state-sync-mirror** — URL `tabId`
      copied to store for store-only readers. Fix: reader hook derives `urlTabId ?? storeTab`.
- [ ] `samples/transcript/TranscriptPanel.tsx` (`setSelectedOutlineId`) — **state-sync-mirror**
      (borderline) — `initialEventId` prop mirrored into `selectedOutlineId`. Fix: set in the
      navigation handler producing the deep link, or track last-applied id during render.
- [ ] `samples/print/SamplePrintView.tsx` (`selectLogFile` + `selectSample`) — **state-sync-mirror**
      (borderline) — print window mirrors route into global selection so selection hooks resolve.
      Fix: call param-driven `useEvalSampleData` directly.
- [ ] `samples/event/SampleEventView.tsx` (`selectLogFile` + `selectSample`) —
      **state-sync-mirror** (borderline) — third copy of the SamplePrintView /
      LogSampleDetailView route→selection block, comment included. Fix: same, and share it.
- [ ] `samples/list/useSamplesView.ts` (column seeding) — **derived-state** — writes visibility for
      not-yet-seen columns into the store post-render (unseeded first frame), persisting the whole
      resolved view so eval-author sort/filter/multiline defaults land with it. Fix: merge in memos
      at render; persist via existing user-action writers.
- [ ] `log-view/tabs/timeline/TimelineTab.tsx` (`setTimeSort` default) — **derived-state**
      (borderline) — seeds the running-log `"desc"` default into the property bag while
      `timeDescending` already derives it in render. The write is load-bearing (it pins the default
      so a run completing mid-session can't flip the list), so the fix is to pin explicitly — record
      the freeze at first view or on the user's first sort — not to delete it.
- [ ] `samples-panel/SamplesPanel.tsx` (`previousSamplesPath` diff) —
      **adjust-state-on-prop-change** — diffs `samplesPath` against store-persisted
      `previousSamplesPath` to clear `displayedSamples`. Fix: record path alongside samples in
      `setDisplayedSamples`; consumer ignores mismatched scope; delete `previousSamplesPath`.
- [ ] `routing/loaders/SampleLoadController.tsx` — **event-logic-in-effect** — watches selection
      identity to reset per-sample UI state; `selectSample` action already has the
      identity-changed branch. Fix: do the resets there; delete the controller.
- [ ] `state/hooks.ts` `useMessageVisibility` (log clear) — **reset-state-on-prop-change** — clears
      visibility on `selectedLogFile` change via a first-render ref hack; remounted instances skip
      the clear (stale leak). Fix: clear centrally in the `selectLogFile` action.
- [ ] `state/hooks.ts` `useMessageVisibility` (sample clear) — **reset-state-on-prop-change** —
      same for `selectedSampleHandle`. Fix: clear in the `selectSample` action.

## Challenging

- [ ] `log-view/LogViewContainer.tsx` (`selectLogFile`) — **state-sync-mirror** (borderline) — route
      `logPath` → `logs.selectedLogFile`, the hub all data hooks key off. Deliberate (host messages,
      single-file mode also write it) but redundant URL-driven state. Fix: route-param-keyed data
      hooks; store fallback for unrouted writers.
- [ ] `log-view/LogSampleDetailView.tsx` (`selectLogFile` + `selectSample`) — **state-sync-mirror**
      (borderline) — same pattern for log+sample selection; keeps a state fallback for VS Code
      restore (dual sources of truth). Same fix.
- [ ] `routing/loaders/SampleRouteSelectionController.tsx` — **state-sync-mirror** — route params →
      store selection on every route change; docstring acknowledges interim. Same architectural
      fix — doing it once collapses all three.
- [ ] `routing/loaders/LogLoadController.tsx` — **event-logic-in-effect** (borderline) — "log
      settled" logic driven by a `details_settled_seq` counter + `demand` split + eslint-disable.
      Fix: completion callback/promise from the active `fetchLog` path invoking a store action;
      delete the seq/demand plumbing.
- [ ] `log_data/log.ts` `useLogHeader` — **fetch-in-effect** (borderline) — fires the engine's
      `fetchLog` per mount beside react-query, with no un-demand on unmount (failures do surface,
      via the row's retrieval facts). Fix: fold demand into the query layer (queryFn awaits engine
      ensure/fetch, or observer count drives demand) so rq owns dedupe and lifecycle.

## Latent bug, still open

- [ ] `log-list/LogsPanel.tsx` single-log redirect, settled gate — NOT shipped with the
      `<Navigate>` fix, needs deliberate decisions: gating on `sync.loading` regresses warm-cache
      redirect latency (full `syncLogs` round trip before the hop), and `useLogListing`'s
      `useDeferredValue` means settled flags can disagree with `logItems` for a frame, so a naive
      gate doesn't fully close the transient hole. The concrete risk it would fix (stale cache
      seeded with a single row) is theoretical so far. The code carries a comment pointing here.

## Shipped

Line refs are historical — as-audited, not as-committed.

- [x] `src/app/App.tsx:173` (fixed: 33d318cb) — **app-init** — startup-blob dispatch +
      `new ClipboardJS()` keyed on `[onMessage]`; re-ran and leaked a ClipboardJS instance per
      identity change. Now an empty-deps effect with `destroy()`, plus a run-once ref on the
      embedded dispatch.
- [x] `src/app/shared/samples-grid/useSampleGridState.ts:56` (fixed: 73518c9d, follow-up cb9edcb1) —
      **derived-state** — seeded default column visibility into the persisted store. Now a `useMemo`
      merge of `{...defaults, ...persisted}`; the write path persists only changed keys, since the
      popover emits the full map and persisting it wholesale froze every derived default.
- [x] `src/app/shared/data-grid/DataGrid.tsx:255` (fixed: 6750b600) —
      **adjust-state-on-prop-change** — mirrored the `selectedRowId` prop into `internalSelectedId`,
      painting a stale frame first. Now the render-adjust pattern (prev-value state, set during
      render).
- [x] `src/app/log-list/grid/columns/hooks.tsx:118` (fixed: 5fb00924) — **derived-state** — seeded
      explicit `false` visibility entries already covered by the `?? defaultVisible` fallback, and
      double-fired (hook mounted twice). Deleted.
- [x] `src/app/log-list/grid/LogListGrid.tsx:224` (fixed: 7254a0a8, follow-up be3adbb1) —
      **event-logic-in-effect** — persisted `activeMatchId` → `selectedRowId` per keystroke while
      the find band was open, though only observed after close. Now persisted once in `closeFind`,
      with an unmount cleanup for navigate-away and a row click disarming the match so
      close/unmount can't clobber it.
- [x] `src/app/samples/SampleDisplay.tsx:462` (fixed: dd56432d) — **adjust-state-on-prop-change** —
      a ref-guarded effect wrote the `"scans"` dock default into the persisted store. Now derived in
      render: `storedDock ?? (hasScans ? "scans" : "none")`.
- [x] `src/app/samples-panel/SamplesPanel.tsx:406` (fixed: a98654ad) —
      **reset-state-on-prop-change** — `clearSelectedSample()` on every `samplesPath` change and
      every mount, wiping the highlight when returning from detail. The cross-log clear now lives in
      `LogViewContainer`'s pre-paint layout effect, keyed on an actual `logPath` change.
- [x] `src/app/routing/loaders/LoaderHost.tsx:39` (fixed: be73e212) — **app-init** —
      `SelectUrlLogFile` applied static `?log_file=` config per mount. Now applied at app-config
      resolution (`resolveAppConfig`); component deleted.
- [x] `src/components/FindBand.tsx:239` (fixed: eaac7d22; now
      `packages/react/src/components/FindBand.tsx`) — **derived-state** (borderline) — built
      `debounce()` into a ref via effect to dodge a compiler lint, never cancelling the superseded
      function. Now the shared `useDebouncedCallback` hook.
- [x] `src/app/log-view/LogViewContainer.tsx:52` (fixed: 38beffc4) — **adjust-state** (borderline) —
      UUID→id/epoch redirect via effect, missing `replace` (back-button bounce). Now
      `useSampleUuidRedirectUrl` + a render-time `<Navigate replace>`.
- [x] `src/app/log-view/LogSampleDetailView.tsx:77` (fixed: 38beffc4) — **adjust-state**
      (borderline) — same UUID redirect; shares the hook and `<Navigate replace>` with the above.
- [x] `src/components/FindBand.tsx:174` (fixed: eaac7d22; now in `packages/react`) — latent bug —
      cleanup captured `scrollTimeoutRef.current` at effect setup (always null), so a later scroll
      timeout was never cleared on unmount. Now read in the cleanup.
- [x] `src/components/MorePopOver.tsx:20` (deleted) — latent bug — deps `[title, customClass]` kept
      stale cloned children when children re-rendered. Moot: zero callers since its 2024
      introduction — deleted instead of fixed.
- [x] `src/app/log-list/LogsPanel.tsx:334` (partial: 0abd830b) — latent bug — single-log
      auto-redirect converted to a render-time `<Navigate replace>` (fixes the back-button trap +
      flash frame; same trigger condition, so no new transients). The settled gate is still open,
      above.
- [x] `src/app/log-list/LogsPanel.tsx:290` (fixed: e3cc661b) — latent bug — same full-map persist
      hazard as cb9edcb1: `handleColumnVisibilityChange` merged the popover's full active-mode map
      into the stored map, freezing mode-dependent defaults (one stored map spans tasks/logs modes,
      whose default-hidden sets differ — e.g. `name`). Now persists only changed keys.

## Appropriate (no action)

All 45, by file. Rebuilt from the tree at `4df0a64`.

**External-system lifecycle** — `log_data/FetchEngineController.tsx` (engine activate/deactivate on
config change); `samples/sample-tools/sample-filter/SampleFilter.tsx` ×5 (CodeMirror construction +
four compartment reconfigures); `routing/AppRouter.tsx` (route → `setUrlHash`).

**DOM event subscriptions** — `App.tsx` (host `message` bridge; `storage` for cross-tab settings);
`samples/SampleDisplay.tsx` (Cmd/Ctrl+P interception).

**One-shot app init** — `App.tsx` (ref-guarded embedded startup dispatch; ClipboardJS + `destroy()`).

**Measurement / observers** — `shared/data-grid/DataGrid.tsx` (ResizeObserver → fit-to-width);
`log-view/title-view/AutogrowText.tsx` (textarea height); `log-view/title-view/TagStrip.tsx` ×2
(`useLayoutEffect` measure-and-converge chip trim, plus a ResizeObserver reset on width change);
`log-view/tabs/timeline/HistoryList.tsx` (`useLayoutEffect` scrollMargin);
`samples/print/SamplePrintView.tsx` (MutationObserver settle → `window.print()`).

**Pre-paint work** — `App.tsx` (`useLayoutEffect` applies the theme before paint so the toggle and
the colors land in one frame); `log-view/LogViewContainer.tsx` (`useLayoutEffect` clears the
cross-log selected sample on route change, so the previous eval can't flash).

**Virtualizer / windowing sync** — `shared/data-grid/DataGrid.tsx` and
`log-view/tabs/timeline/HistoryList.tsx` (scroll-to-selection, each ref-guarded against re-scroll on
unrelated identity churn); `samples/transcript/chunked/ChunkedTranscriptPanel.tsx` ×3 (materialize
chunks under visible placeholders, re-scroll to the anchored ordinal when row accounting changes,
track the topmost visible ordinal).

**Focus management** — `shared/data-grid/DataGrid.tsx` (mount autofocus);
`log-view/title-view/EditMetadataDialog.tsx` (focus + scroll the just-added row);
`samples/SampleDisplay.tsx` (focus the panel on load).

**`document.title`** — `log-list/LogsPanel.tsx`, `samples/SampleDisplay.tsx`,
`samples/list/SampleList.tsx`, `samples/event/SampleEventView.tsx`.

**Lifecycle-tied store teardown** — `log-view/LogViewContainer.tsx` (`unloadLog` on unmount);
`samples-panel/SampleDetailView.tsx` (`clearLog` + `clearSampleTab`); `samples/SampleDisplay.tsx` ×2
(`clearSampleTab`; GC of the visit's snapshot bags).

**Timer cleanup** — `state/hooks.ts` `useSamplePopover`;
`log-view/tabs/timeline/TimelineChart.tsx` (popover close timer).

**Debounced / latest-value bookkeeping** — `log-list/listing/useLogsListingQuery.ts`
`useLogsListingMatches` (debounced find-term mirror — the timer is the point);
`samples/InlineSampleDisplay.tsx` ×2 (latest-value ref for a deep-link mount; scroll to top on a new
visit).

**Persisting armed find state** — `log-list/grid/LogListGrid.tsx` ×2 (arm the match ref while the
band is open; persist it on unmount) — the shape the `LogListGrid:224` fix landed on.

**Publishing a computed value to an external store** — `state/hooks.ts` `useFilteredSamples`
publishes the filter error. Added by #508 to *replace* a store write during render: the write made
SampleFilter update while SamplesTab rendered and left the memo impure, which React Compiler is free
to cache, stranding a stale error on the filter input.

**Draining a paginated query to a target** — `log_data/messageRowsQuery.ts` `useMessageRows` fetches
next pages until the deep-linked message is resident. Rendered state drives it and react-query owns
the lifecycle (unlike `useLogHeader`, above), so the effect is the loop; draining inside the queryFn
would block first paint of the earlier pages.
