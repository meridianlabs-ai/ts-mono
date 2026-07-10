# useEffect audit — apps/inspect

Audit of all `useEffect` usage against [You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect).
68 effects audited (66 `useEffect` + 2 adjacent `useLayoutEffect`): 37 appropriate, 31 inappropriate (22 firm, 9 borderline).

Working doc: check items off (and note the commit) as fixes land. Line numbers are as of the audit commit and will drift.

## Themes

1. **URL ↔ zustand double-bookkeeping (`state-sync-mirror`)** — ~8 instances. Route params copied into
   `logs.selectedLogFile` / `selectedSampleHandle` / `tabs.workspace` via effects so store-keyed data hooks fire.
   `SampleRouteSelectionController`'s docstring admits this is interim. Real fix: data hooks keyed on route
   params; store only for unrouted selection. One architecture change eliminates ~5 effects.
2. **Column-visibility seeding (`derived-state`)** — 3 near-identical effects write computable defaults into
   zustand instead of merging at read time.
3. **routing/loaders effect chain** — route change → selection effect → reset effect → fetch effect →
   settle-seq effect, each link guarded by identity strings/seq counters/demand flags.
4. **`get_user_info()` fetch-in-effect** — duplicated in both edit dialogs; should be a shared react-query hook.

## Surgical

- [ ] `src/app/App.tsx:173` — **app-init** — startup-blob dispatch + `new ClipboardJS()` keyed on `[onMessage]`;
      re-runs and leaks a ClipboardJS instance per identity change. Fix: run-once (module scope or empty-deps
      effect with `destroy()` cleanup); guard embedded-state dispatch with run-once ref.
- [ ] `src/app/shared/samples-grid/useSampleGridState.ts:56` — **derived-state** — seeds default column
      visibility into persisted store. Fix: `useMemo` merge `{...defaults, ...persisted}`; write only on user toggle.
- [ ] `src/app/shared/data-grid/DataGrid.tsx:255` — **adjust-state-on-prop-change** — mirrors `selectedRowId`
      prop into `internalSelectedId`; stale frame paints first. Fix: render-adjust pattern (prev-value state,
      set during render).
- [ ] `src/app/log-list/grid/columns/hooks.tsx:118` — **derived-state** — seeds explicit `false` visibility
      entries already covered by `?? defaultVisible` fallback; double-fires (hook mounted twice). Fix: delete.
- [ ] `src/app/log-list/grid/LogListGrid.tsx:224` — **event-logic-in-effect** — persists `activeMatchId` →
      `selectedRowId` per keystroke while find band open; only observed after close. Fix: persist once in `closeFind`
      (+ unmount cleanup if band open on navigate-away).
- [ ] `src/app/samples/SampleDisplay.tsx:462` — **adjust-state-on-prop-change** — ref-guarded effect writes
      `"scans"` dock default into persisted store. Fix: derive `storedDock ?? (hasScans ? "scans" : "none")` in render.
- [ ] `src/app/samples-panel/SamplesPanel.tsx:406` — **reset-state-on-prop-change** — `clearSelectedSample()`
      on every `samplesPath` change and every mount (wipes highlight returning from detail). Fix: clear in
      navigation action or validate scope at read time.
- [ ] `src/app/routing/loaders/LoaderHost.tsx:39` — **app-init** — `SelectUrlLogFile` applies static
      `?log_file=` config per mount. Fix: invoke `selectLogFile` at app-config resolution; delete component.
- [ ] `src/components/FindBand.tsx:239` — **derived-state** (borderline) — builds `debounce()` into a ref via
      effect (compiler-lint dodge); superseded debounced fn never cancelled. Fix: lazy-init ref wrapping a
      latest-callback trampoline.
- [ ] `src/app/log-view/LogViewContainer.tsx:52` — **adjust-state** (borderline) — UUID→id/epoch redirect via
      effect, missing `replace` (back-button bounce). Fix: render `<Navigate replace>`.
- [ ] `src/app/log-view/LogSampleDetailView.tsx:77` — **adjust-state** (borderline) — same UUID redirect (has
      `replace`). Fix: shared `<Navigate replace>` component with the above.

## Moderate

- [ ] `src/app/log-view/LogViewContainer.tsx:82` — **event-logic-in-effect** — host-message → store
      `initialState` → effect → `navigate()`. Fix: `onMessage` navigates directly via the `AppRouter` singleton;
      delete slice field + effect.
- [ ] `src/app/log-view/LogViewContainer.tsx:113` — **state-sync-mirror** — URL `tabId` mirrored into
      `tabs.workspace`. Fix: URL canonical; clicks only navigate.
- [ ] `src/app/log-view/tabs/SamplesTab.tsx:464` — **derived-state** — single-sample auto-select written to
      store. Fix: derive only-sample fallback in selection hook or pass props to `InlineSampleDisplay`.
- [ ] `src/app/log-view/title-view/EditTagsDialog.tsx:61` — **fetch-in-effect** — `get_user_info()` with manual
      cancelled flag; refetches when `currentTags` changes. Fix: shared `useUserInfo()` react-query hook; derive
      author `edited ?? userInfo?.name ?? ""`.
- [ ] `src/app/log-view/title-view/EditMetadataDialog.tsx:197` — **fetch-in-effect** — identical pattern; fix
      together with EditTagsDialog.
- [ ] `src/app/shared/samples-grid/SamplesGrid.tsx:212` — **pass-data-to-parent** — `onDisplayedRowsChange(items)`
      pushes shaped rows up to SamplesPanel → zustand. Fix: lift query/filter/sort shaping to the owner.
- [ ] `src/app/samples/SampleDisplay.tsx:151` — **adjust-state-on-prop-change** — zero-event sample forces
      messages tab into global store per `sample` identity change; can fight the user. Fix: store holds "unset"
      until user picks; derive default in render.
- [ ] `src/app/samples/SampleDetailComponent.tsx:116` — **state-sync-mirror** — URL `tabId` copied to store for
      store-only readers. Fix: reader hook derives `urlTabId ?? storeTab`.
- [ ] `src/app/samples/transcript/TranscriptPanel.tsx:254` — **state-sync-mirror** (borderline) —
      `initialEventId` prop mirrored into `selectedOutlineId`. Fix: set in the navigation handler producing the
      deep link, or track last-applied id during render.
- [ ] `src/app/samples/print/SamplePrintView.tsx:52` — **state-sync-mirror** (borderline) — print window mirrors
      route into global selection so selection hooks resolve. Fix: call param-driven `useEvalSampleData` directly.
- [ ] `src/app/samples/list/useSamplesView.ts:168` — **derived-state** — seeds resolved view into store
      post-render (unseeded first frame). Fix: merge in memos at render; persist via existing user-action writers.
- [ ] `src/app/samples-panel/SamplesPanel.tsx:300` — **adjust-state-on-prop-change** — diffs `samplesPath` vs
      store-persisted `previousSamplesPath` to clear `displayedSamples`. Fix: record path alongside samples in
      `setDisplayedSamples`; consumer ignores mismatched scope; delete `previousSamplesPath`.
- [ ] `src/app/routing/loaders/SampleLoadController.tsx:39` — **event-logic-in-effect** — watches selection
      identity to reset per-sample UI state; `selectSample` action already has the identity-changed branch. Fix:
      do resets there; delete controller.
- [ ] `src/state/hooks.ts:450` — **reset-state-on-prop-change** — `useMessageVisibility` clears visibility on
      `selectedLogFile` change via first-render ref hack; remounted instances skip the clear (stale leak). Fix:
      clear centrally in `selectLogFile` action.
- [ ] `src/state/hooks.ts:466` — **reset-state-on-prop-change** — same for `selectedSampleHandle`. Fix: clear in
      `selectSample` action.

## Challenging

- [ ] `src/app/log-view/LogViewContainer.tsx:118` — **state-sync-mirror** (borderline) — route `logPath` →
      `logs.selectedLogFile`, the hub all data hooks key off. Deliberate (host messages, single-file mode also
      write it) but redundant URL-driven state. Fix: route-param-keyed data hooks; store fallback for unrouted writers.
- [ ] `src/app/log-view/LogSampleDetailView.tsx:64` — **state-sync-mirror** (borderline) — same pattern for
      log+sample selection; keeps a state fallback for VS Code restore (dual sources of truth). Same fix.
- [ ] `src/app/routing/loaders/SampleRouteSelectionController.tsx:22` — **state-sync-mirror** — route params →
      store selection on every route change; docstring acknowledges interim. Same architectural fix — doing it
      once collapses all three.
- [ ] `src/app/routing/loaders/LogLoadController.tsx:42` — **event-logic-in-effect** (borderline) — "log
      settled" logic driven by `details_settled_seq` counter + `demand` split + eslint-disable. Fix: completion
      callback/promise from the active `fetchLog` path invoking a store action; delete seq/demand plumbing.
- [ ] `src/log_data/log.ts:70` — **fetch-in-effect** (borderline) — `useLogHeader` fires engine `fetchLog` per
      mount beside react-query (no un-demand on unmount, errors swallowed). Fix: fold demand into query layer
      (queryFn awaits engine ensure/fetch, or observer-count drives demand) so rq owns dedupe/lifecycle.

## Latent bugs in otherwise-appropriate effects

- [ ] `src/components/FindBand.tsx:174` — cleanup captures `scrollTimeoutRef.current` at effect setup (always
      null); later scroll timeout never cleared on unmount. Fix: read ref in cleanup.
- [ ] `src/components/MorePopOver.tsx:20` — deps `[title, customClass]`; popover keeps stale cloned children
      when children re-render.
- [ ] `src/app/log-list/LogsPanel.tsx:334` — single-log auto-redirect can fire on transient length-1 listing
      mid-sync; safer as `<Navigate>` on settled data.

## Appropriate (no action)

DOM event subscriptions (`LogViewLayout:45`, `DataGrid`, `SampleDetailComponent:177`, `SampleDisplay:333`,
`FindBand:258`, `LogListGrid:242`, `App.tsx:90/:166`); third-party widgets (CodeMirror ×5 in `SampleFilter`,
`AsciinemaPlayer`, `MorePopOver`); focus management (`LargeModal:75`, `DataGrid:266`, `EditMetadataDialog:281`,
`SampleDisplay:227`, `FindBand:174`); measurement/observers (`AutogrowText`, `DataGrid:502`,
`utils/dom.ts:85`, `SamplePrintView:81`); `document.title` (`LogsPanel:91`, `SampleDisplay:141`,
`SampleList:88`); virtualizer scroll sync (`DataGrid:638`); lifecycle-tied store teardown
(`SampleDisplay:163/:217`, `LogViewContainer:46/:102`, `SampleDetailView:111`); router hash persistence
(`AppRouter:46`); timer cleanup (`state/hooks.ts:518`); dev diagnostic (`utils/react.ts:9`).
