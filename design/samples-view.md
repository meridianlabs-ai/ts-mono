# SamplesView descriptor

## What this is

A single descriptor, `TaskSamplesView`, captures the user's view of the samples list shown for a single eval log (the log view's Samples tab). It covers:

1. **Visible columns and their order**
2. **Sort columns** (asc/desc)
3. **Multiline mode** (true = list-style 70px rows; false = compact 30px rows)
4. **Compact-score mode** (`compact_scores`): narrow rotated 45° headers for score columns
5. **Color-scale toggle** (`color_scales_enabled`): whether the score-cell heatmap is on
6. **Score labels** (`score_labels`): display-name overrides per score
7. **Score color scales** (`score_color_scales`): per-score cell-background heatmaps

Eval authors set it with `Task(viewer=ViewerConfig(task_samples_view=...))`; users edit it through the grid and the view options popover. User-stored state shadows the eval-author default: `user > eval default > built-in`.

Axes 1–5 are *editable user state*, persisted in the zustand store. Axes 6–7 are *eval-author-only metadata*, read from the wire on each render so a stored view from a prior eval can't shadow the current eval's labels or scales. See "Wire-only fields" below.

This is distinct from `sample_score_view` (also under `ViewerConfig`), which configures the score panel inside an individual sample's detail view.

## Scope

- `SamplesTab` (`apps/inspect/src/app/log-view/tabs/SamplesTab.tsx`) owns the descriptor through `useSamplesView` and passes the resolved state to `SampleList`. Runtime state is keyed **per log file** in `samplesListState.byLog[logFile]`, so logs with different scorer columns don't share customizations.
- `SamplesGrid` (`apps/inspect/src/app/shared/samples-grid/SamplesGrid.tsx`) renders rows for both `SampleList` and `SamplesPanel` on top of the shared TanStack `DataGrid`. It does not own the descriptor; it receives `multiline` and column state as props.
- `SamplesPanel` (the cross-log samples view) does not use the descriptor. Its grid state goes through `useSampleGridState("samplesPanel", ...)`.

## Two related types

The Python type is what eval authors write; the TypeScript runtime type is what the store holds. They differ because the runtime resolves nullable fields and tracks which toggles the user has explicitly flipped.

### Wire / Python type

Defined as `TaskSamplesView`, `TaskSamplesColumn`, `TaskSamplesSort` and `ScoreColorScale` in [`src/inspect_ai/viewer/_config.py`](../../../viewer/_config.py) and carried through the eval log via `EvalSpec.viewer`. Every field except `name` is nullable, meaning "no eval-author default; viewer default applies". `ViewerConfig.task_samples_view` accepts a single view or a list.

Score columns are addressed by id `score__<scorer>__<score>`; authors build them with `TaskSamplesColumn.score(...)` / `TaskSamplesSort.score(...)` rather than writing the id by hand.

`score_color_scales` accepts three shapes per entry:

- **String shorthand** for numeric scores: `{"accuracy": "good-high"}` paints a gradient anchored at the descriptor's auto-detected min/max.
- **`ScoreColorScale` object** for numeric scores with a known *conceptual* range: `{"concerning": ScoreColorScale(palette="good-low", min=1, max=10)}` pins the gradient to a fixed range so middling values aren't clamped to the extremes when observed data clusters at one end.
- **Categorical value→role map**: `{"verdict": {"yes": "bad", "no": "good"}}` for non-numeric scores. Roles resolve to Bootstrap `*-bg-subtle` CSS variables so both themes stay legible.

Pass/fail and boolean score types ignore color scales (their pills already encode the semantic). The resolver lives in [`apps/inspect/src/app/shared/samples-grid/colorScale.ts`](../apps/inspect/src/app/shared/samples-grid/colorScale.ts).

### Runtime / TS type

`SamplesViewState` in [`apps/inspect/src/app/samples/list/samplesView.ts`](../apps/inspect/src/app/samples/list/samplesView.ts) re-exports the generated wire types and adds the live in-store form: resolved (non-null) `columns`, `sort`, `multiline`, `compactScores` and `colorScalesEnabled`, plus

- **`userOverrides`**: a sparse map of the toggles (`multiline`, `compactScores`, `colorScalesEnabled`) the user has explicitly flipped. A field present here wins over the eval-author default; an absent field falls through to it. Without this, a toggle value stored while viewing one eval would silently shadow a different eval's default.
- **`columnWidths`**: sparse user-resized pixel widths, per log. Toggling compact scores drops score-column widths, since they are sized per mode.

`SamplesViewState` also still carries `filters: { dsl, extraColumnFilters }`, a leftover from the AG Grid era. It is always initialized empty and nothing reads it.

### Wire-only fields

`score_labels` and `score_color_scales` are deliberately **not** lifted into `SamplesViewState`. The runtime state persists across evals, so storing these would let a previous eval's labels or scales shadow the current eval's. They are read from the wire on each render via `useSamplesViewScoreLabels` and `useSamplesViewScoreColorScales` in [`useSamplesView.ts`](../apps/inspect/src/app/samples/list/useSamplesView.ts). [`samplesView.converters.test.ts`](../apps/inspect/src/app/samples/list/samplesView.converters.test.ts) pins that `liftEvalView` copies neither field.

Pure converters in [`samplesView.converters.ts`](../apps/inspect/src/app/samples/list/samplesView.converters.ts) cover the boundary: `liftEvalView`, `pickActiveView`, `resolveSamplesView`, and the sort mappers `viewSortToSorting` / `sortingToViewSort`. (`flattenToEvalView` and `mergeColumnVisibility` are exercised only by tests.)

## Resolution priority

`resolveSamplesView(stored, evalDefault)`:

- **No stored view**: lift the eval default (`eval.viewer.task_samples_view` from `useSelectedLogDetails()`, normalized by `pickActiveView`, which takes the first entry of a list), or `defaultSamplesView()` when there is none.
- **Stored view**: use it, except that each toggle without a `userOverrides` entry takes the eval default's value.

The sample score panel uses the same pattern in `resolveScorePanelSort` / `useEvalScorePanelView` in [`apps/inspect/src/state/hooks.ts`](../apps/inspect/src/state/hooks.ts).

## Columns not yet in the view

Column sets can grow after first render, for example when log details stream in and scorer columns appear later. `useSamplesView` appends any column it hasn't seen to the stored view with a seeded default visibility (`seedDefaultVisibility`), leaving existing entries and their order alone. The column popover writes through `useSamplesView`'s `setColumnVisibility`, which updates known ids in place and appends unknown ones, so a write during a partial load doesn't erase customizations.

## `selectedScores` adapter

`selectedScores` (on the `state.log` slice) gates which `score__*` columns exist. It is not part of the descriptor. `SamplesTab` projects it into `columns[].visible` for `score__*` ids on read and splits `score__*` toggles back into `setSelectedScores` on write.

## Persistence

The store's `persist` middleware in [`apps/inspect/src/state/store.ts`](../apps/inspect/src/state/store.ts) uses host-injected `ClientStorage`. Persistence is transient (the VS Code extension uses it to survive webview recreation), not long-lived localStorage. A version mismatch on rehydrate drops the stored state.

## logDir change behavior

Per-log scoping means a logDir change doesn't reset SampleList state; each log keeps its own `byLog[logFile]` bucket.

## Not in this descriptor

- **No filter.** The wire type has no filter field; an earlier DSL `filter` was removed in inspect_ai #4110 (tracked here in #272).
- **No `id` field**, only `name`. Identity can be added if multi-view selection lands.
- **Multi-view selection** is accepted on the wire (`TaskSamplesView | list[TaskSamplesView]`), but only the first entry is read. There is no UI for switching or saving views yet.

## Test coverage

- **Python wire shape** (Pydantic round-trip, Task→EvalSpec persistence): [tests/view/test_viewer_config.py](../../../../tests/view/test_viewer_config.py), [tests/view/test_viewer_config_task.py](../../../../tests/view/test_viewer_config_task.py)
- **TS converters and defaults**: [samplesView.converters.test.ts](../apps/inspect/src/app/samples/list/samplesView.converters.test.ts), [samplesView.test.ts](../apps/inspect/src/app/samples/list/samplesView.test.ts)
- **End to end**: [top-level-views.spec.ts](../apps/inspect/e2e/top-level-views.spec.ts) covers an eval-author `compact_scores` default reaching the rendered grid. Other axes are not covered end to end.

## File pointers

- Python types: [`src/inspect_ai/viewer/_config.py`](../../../viewer/_config.py)
- Generated TS wire types: [`packages/inspect-common/src/types/generated.ts`](../packages/inspect-common/src/types/generated.ts) (autogenerated; do not edit)
- TS runtime descriptor: [`apps/inspect/src/app/samples/list/samplesView.ts`](../apps/inspect/src/app/samples/list/samplesView.ts)
- Hook and wire-only readers: [`apps/inspect/src/app/samples/list/useSamplesView.ts`](../apps/inspect/src/app/samples/list/useSamplesView.ts)
- Owner: [`apps/inspect/src/app/log-view/tabs/SamplesTab.tsx`](../apps/inspect/src/app/log-view/tabs/SamplesTab.tsx)
