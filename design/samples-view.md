# SamplesView descriptor

Status: Phase 0 (types only — no runtime wiring yet).

## What this is

A single descriptor — `SamplesView` — that captures the user's view of the inspect app's **SampleList** (the per-task list of samples shown in a single eval log). The descriptor covers four axes:

1. **Visible columns + their order**
2. **Sort columns** (with asc/desc)
3. **Filter** — a DSL expression string
4. **Multiline mode** (true = list-style 88px rows; false = compact 30px rows)

The descriptor can be set by the eval author via `Task(viewer=ViewerConfig(task_samples_view=...))`, and (later) edited via UI. User-stored overrides shadow the eval-author default; resolution priority is `user > eval default > built-in`.

This is distinct from `sample_score_view` (also under `ViewerConfig`), which configures the score panel inside an individual sample's detail view. `task_samples_view` is the field name on `ViewerConfig` (it makes the hierarchy level explicit — "the task's samples list"); the type is `SamplesView`.

## Scope (Phase 0–2)

- The descriptor is owned by `SampleList` (`apps/inspect/src/app/samples/list/SampleList.tsx`, single-log scope `logViewSamples`).
- `SamplesGrid` (`apps/inspect/src/app/shared/samples-grid/SamplesGrid.tsx`) is a dumb-ish ag-grid renderer used by both `SampleList` and `SamplesPanel`. It does not own the descriptor; in Phase 2 it grows a single optional prop `multiline?: boolean`.
- `SamplesPanel` (cross-log dataframe view, scope `samplesPanel`) is **out of scope**. It can adopt the descriptor in a follow-on, but its persisted state shape is unchanged here.

## Two related types

The Python type is what eval authors write; the TypeScript runtime type is what the SampleList store holds. They are related but not identical because the runtime carries ag-grid–specific filter residue that is nonsense to expose in Python.

### Wire / Python type

Defined in [`src/inspect_ai/viewer/_config.py`](../../../viewer/_config.py) and round-tripped through the eval log via `EvalSpec.viewer`:

```python
class SamplesSort(BaseModel):
    column: str
    dir: Literal["asc", "desc"] = "asc"


class SamplesColumn(BaseModel):
    id: str
    visible: bool = True


class SamplesView(BaseModel):
    name: str                                     # required
    columns: list[SamplesColumn] | None = None
    sort: list[SamplesSort] | None = None
    filter: str | None = None                     # raw DSL expression
    multiline: bool | None = None                 # True=wrap, False=compact


# In ViewerConfig:
task_samples_view: SamplesView | list[SamplesView] | None = None
```

`SamplesView.filter` is intentionally just a string — the DSL is designed to be written by hand (`"has_error or score < 0.5"`, `"input_contains(\"abc\")"`, etc.). There is no Python-side builder; authors compose filters directly as filtrex expressions.

### Runtime / TS type

Defined in [`apps/inspect/src/app/samples/list/samplesView.ts`](../apps/inspect/src/app/samples/list/samplesView.ts). Re-exports the OpenAPI-generated wire types and adds a `SamplesViewState` for the live in-store form:

```ts
interface SamplesViewState {
  name: string;
  columns: Array<{ id: string; visible: boolean }>;     // resolved (no null)
  sort: Array<{ colId: string; dir: "asc" | "desc" }>;  // resolved (no null)
  filters: {
    dsl: string;
    /** ag-grid filterModel residue — entries not expressible as DSL.
     *  Never serialized to Python. */
    extraColumnFilters: FilterModel;
  };
  multiline: boolean;
}
```

Why a separate runtime type?

1. **`extraColumnFilters`** carries column-header filter entries that the DSL parser can't represent (typed-set selectors, regex on raw string columns). It exists only in the browser; eval authors don't see it. Promoting it onto the wire would force every eval log to know ag-grid internals.
2. **`null` resolution** — wire fields are nullable to mean "no eval-author default; viewer default applies." The runtime type has those resolved into concrete arrays/strings/booleans.

Phase 1 introduces pure converter functions for the boundary:

- `liftEvalView(SamplesView | undefined, availableColIds): SamplesViewState`
- `flattenToEvalView(SamplesViewState): SamplesView`
- `pickActiveView(SamplesView | SamplesView[] | undefined): SamplesView | undefined`
- `resolveSamplesView(stored, evalDefault): SamplesViewState`

## Resolution priority

Mirrors the existing `resolveScorePanelSort` pattern in [`apps/inspect/src/state/hooks.ts`](../apps/inspect/src/state/hooks.ts) (~lines 106–142):

- **User-stored** (zustand-persisted, transient via host-injected storage) wins if present.
- **Eval default** from `state.log.selectedLogDetails?.eval.viewer?.task_samples_view` is normalized via `pickActiveView` (handles the `SamplesView | SamplesView[]` union; first entry of a list is the default for now).
- **Built-in default** from `defaultSamplesView()` if neither is set.

## Column-id instability tolerance

Score columns include scorer + metric (`score__<scorer>__<metric>`). A view recorded against one log may reference columns that don't exist in another. The boundary contract:

- Read time: `viewToGridState(view, availableColIds)` excludes unknown ids from the `GridState` it hands ag-grid. The persisted descriptor is **not** mutated. When the user navigates to a log that does have those columns, references re-engage automatically.
- Same rule for sort entries naming missing columns and `extraColumnFilters` keyed on missing columns.

## `selectedScores` adapter

`selectedScores` (on the `state.log` slice) gates which `score__*` columns exist. It is **not** moved into the descriptor in Phases 0–2; it stays where it is, and the future `useSamplesView` hook projects it into `columns[].visible` for `score__*` ids on read, splitting `score__*` toggles back into `setSelectedScores` on write. This keeps the blast radius of the refactor bounded.

## Persistence

The store's `persist` middleware in [`apps/inspect/src/state/store.ts`](../apps/inspect/src/state/store.ts) uses host-injected `ClientStorage`. Persistence is transient (used in the VSCode extension to survive tab backgrounding), not long-lived localStorage. There is no formal versioned migrator — the read boundary in Phase 2 will handle the legacy `byScope.logViewSamples = { columnVisibility, gridState }` shape gracefully via a `legacyToView(slot, dslFilter): SamplesViewState` helper, and the first user write replaces it with the new `{ view }` shape.

## logDir change behavior

In Phase 2, navigating to a different log directory will keep `view.columns` and `view.multiline` for `logViewSamples` and reset only `view.filters` and `view.sort`. Today the entire `gridState` is wiped; the narrowing preserves column choices and row layout (general preferences) while still clearing log-specific filter/sort state. SamplesPanel scope behavior is unchanged.

## What is explicitly NOT in this descriptor

- **`extraColumnFilters` is TS-only** — never serialized to Python.
- **No structured filter builder** — `SamplesView.filter` is just a DSL string. Authors who want the column-header-edit shape will get it from the future view editor UI; for programmatic construction they write the string directly.
- **No `id` field on `SamplesView`** — only `name`. If multi-view selection lands later, identity can be added then; today there's just one active view per scope.
- **Multi-view selection** is supported on the wire (`task_samples_view: SamplesView | list[SamplesView]`) but only the first entry is read in Phases 0–2. UI for switching/saving views is a follow-on.

## File pointers

- Python types: [`src/inspect_ai/viewer/_config.py`](../../../viewer/_config.py)
- Python tests: [`tests/view/test_viewer_config.py`](../../../../tests/view/test_viewer_config.py), [`tests/view/test_viewer_config_task.py`](../../../../tests/view/test_viewer_config_task.py)
- Generated TS wire types: [`packages/inspect-common/src/types/generated.ts`](../packages/inspect-common/src/types/generated.ts) (autogenerated — do not edit)
- TS runtime descriptor: [`apps/inspect/src/app/samples/list/samplesView.ts`](../apps/inspect/src/app/samples/list/samplesView.ts)
- Re-exports for app code: [`packages/inspect-common/src/types/index.ts`](../packages/inspect-common/src/types/index.ts)
- Existing pattern reference: `useEvalScorePanelView` / `resolveScorePanelSort` in [`apps/inspect/src/state/hooks.ts`](../apps/inspect/src/state/hooks.ts) (~lines 106–142)
