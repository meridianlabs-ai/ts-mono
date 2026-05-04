/**
 * Pure converters between the on-the-wire `SamplesView`, the runtime
 * `SamplesViewState`, and ag-grid's `GridState`.
 *
 * No runtime imports — every function here is referentially transparent
 * given its inputs, so unit tests can exercise them in isolation. Phase 2
 * wires these into the SampleList store + hook.
 */
import type { FilterModel, GridState } from "ag-grid-community";

import type { SamplesView } from "@tsmono/inspect-common/types";

import { defaultSamplesView, type SamplesViewState } from "./samplesView";

// ---------------------------------------------------------------------------
// Wire ↔ runtime
// ---------------------------------------------------------------------------

/**
 * Lift a wire `SamplesView` into the runtime `SamplesViewState`.
 *
 * - Nullable wire fields collapse to defaults from `defaultSamplesView()`.
 * - Sort entries map `column` → `colId` to match ag-grid naming on the
 *   runtime side. Wire form keeps `column` to match the Python field.
 * - `extraColumnFilters` starts empty; ag-grid filterModel residue is
 *   only synthesized at runtime when the user sets column-header filters
 *   the DSL can't express.
 */
export const liftEvalView = (
  wire: SamplesView | undefined | null
): SamplesViewState => {
  const fallback = defaultSamplesView();
  if (!wire) return fallback;
  return {
    name: wire.name,
    columns: wire.columns
      ? wire.columns.map((c) => ({ id: c.id, visible: c.visible ?? true }))
      : fallback.columns,
    sort: wire.sort
      ? wire.sort.map((s) => ({ colId: s.column, dir: s.dir ?? "asc" }))
      : fallback.sort,
    filters: { dsl: wire.filter ?? "", extraColumnFilters: {} },
    multiline: wire.multiline ?? fallback.multiline,
  };
};

/**
 * Flatten a runtime state back to its wire shape. `extraColumnFilters` is
 * dropped — that field is TS-only and never crosses the wire. Used to
 * compare a stored view against an eval default for override detection.
 */
export const flattenToEvalView = (state: SamplesViewState): SamplesView => ({
  name: state.name,
  columns: state.columns.map((c) => ({ id: c.id, visible: c.visible })),
  sort: state.sort.map((s) => ({ column: s.colId, dir: s.dir })),
  filter: state.filters.dsl ? state.filters.dsl : null,
  multiline: state.multiline,
});

/**
 * `task_samples_view` may be a single view, a list of views, or absent.
 * For Phase 0–2 we honour only the first entry of a list.
 */
export const pickActiveView = (
  field: SamplesView | SamplesView[] | undefined | null
): SamplesView | undefined => {
  if (!field) return undefined;
  if (Array.isArray(field)) return field[0];
  return field;
};

/**
 * Resolution priority: stored (user-modified runtime state) > eval default
 * (lifted from `eval.viewer.task_samples_view`) > built-in default.
 *
 * Mirrors the precedence pattern used by `resolveScorePanelSort` in
 * `apps/inspect/src/state/hooks.ts`.
 */
export const resolveSamplesView = (
  stored: SamplesViewState | undefined,
  evalDefault: SamplesView | undefined | null
): SamplesViewState => {
  if (stored) return stored;
  return liftEvalView(evalDefault);
};

// ---------------------------------------------------------------------------
// Runtime ↔ ag-grid GridState (column-id tolerance applied at this boundary)
// ---------------------------------------------------------------------------

/**
 * Project the runtime descriptor into the `GridState` ag-grid consumes.
 *
 * Column-id tolerance: any persisted reference to a column not present in
 * `availableColIds` (e.g. `score__judge__correctness` on a log without
 * that scorer) is excluded from the emitted GridState but **preserved
 * unchanged in the source descriptor**. The persisted view is never
 * mutated by a render.
 *
 * The DSL filter is intentionally *not* materialized into `filterModel`
 * here — that translation needs the live filter registry, which only
 * exists at runtime. Phase 2's `useSamplesView` layers the DSL→model
 * translation on top of this base GridState.
 */
export const viewToGridState = (
  view: SamplesViewState,
  availableColIds: ReadonlySet<string>
): GridState => {
  const knownColumns = view.columns.filter((c) => availableColIds.has(c.id));
  const sortModel = view.sort
    .filter((s) => availableColIds.has(s.colId))
    .map((s) => ({ colId: s.colId, sort: s.dir }));
  const filterModel: FilterModel = Object.fromEntries(
    Object.entries(view.filters.extraColumnFilters).filter(([colId]) =>
      availableColIds.has(colId)
    )
  );
  return {
    columnVisibility: {
      hiddenColIds: knownColumns.filter((c) => !c.visible).map((c) => c.id),
    },
    columnOrder: { orderedColIds: knownColumns.map((c) => c.id) },
    sort: { sortModel },
    filter: { filterModel },
  };
};

/**
 * Fold a fresh ag-grid `GridState` back into the runtime descriptor,
 * preserving any unknown-id references from `prev` so they re-engage when
 * the user navigates back to a log that has those columns.
 *
 * Note: this updates `columns`, `sort`, and `filters.extraColumnFilters`.
 * The `dsl` half of `filters` is the responsibility of the caller — it
 * comes from a different signal (the toolbar text) and is partitioned
 * via `partitionFilterModel`.
 */
export const gridStateToView = (
  prev: SamplesViewState,
  gridState: GridState,
  availableColIds: ReadonlySet<string>
): SamplesViewState => {
  const orderedColIds = gridState.columnOrder?.orderedColIds ?? [];
  const hiddenColIds = new Set(gridState.columnVisibility?.hiddenColIds ?? []);
  const knownColumns = orderedColIds
    .filter((id) => availableColIds.has(id))
    .map((id) => ({ id, visible: !hiddenColIds.has(id) }));
  const unknownColumns = prev.columns.filter((c) => !availableColIds.has(c.id));

  const sortModel = gridState.sort?.sortModel ?? [];
  const knownSort = sortModel
    .filter((s) => availableColIds.has(s.colId))
    .map((s) => ({ colId: s.colId, dir: s.sort }));
  const unknownSort = prev.sort.filter((s) => !availableColIds.has(s.colId));

  const fmModel = gridState.filter?.filterModel ?? {};
  const knownExtras = Object.fromEntries(
    Object.entries(fmModel).filter(([colId]) => availableColIds.has(colId))
  );
  const unknownExtras = Object.fromEntries(
    Object.entries(prev.filters.extraColumnFilters).filter(
      ([colId]) => !availableColIds.has(colId)
    )
  );

  return {
    ...prev,
    columns: [...knownColumns, ...unknownColumns],
    sort: [...knownSort, ...unknownSort],
    filters: {
      dsl: prev.filters.dsl,
      extraColumnFilters: { ...knownExtras, ...unknownExtras },
    },
  };
};

/**
 * Replace `view.columns[].visible` from a `(colId → visible)` map without
 * touching column order. Use when the column-selector popover hands back
 * a visibility map (e.g. ColumnSelectorPopover). Unknown ids in the map
 * are ignored; ids in the view but absent from the map are left as-is.
 */
export const mergeColumnVisibility = (
  view: SamplesViewState,
  visibility: Record<string, boolean>
): SamplesViewState => ({
  ...view,
  columns: view.columns.map((c) =>
    c.id in visibility ? { ...c, visible: visibility[c.id] } : c
  ),
});

// ---------------------------------------------------------------------------
// Filter-model partitioning
// ---------------------------------------------------------------------------

/**
 * A predicate that, given one column's filter entry, returns the DSL
 * fragment for that entry, or `null` if the entry isn't expressible in
 * DSL. In Phase 2 the inspect app supplies
 * `(colId, entry) => filterModelToText({[colId]: entry}, registry)`
 * — see `apps/inspect/src/app/samples/sample-tools/filterModelToText.ts`.
 */
export type FilterEntryToDsl = (
  colId: string,
  entry: FilterModel[string]
) => string | null;

/**
 * Split an ag-grid `FilterModel` into:
 *   - `dsl` — the round-trippable entries, ANDed and rendered as a
 *     filtrex expression string;
 *   - `extra` — column entries the DSL can't represent (typed-set
 *     selectors, regex-on-string columns, etc.).
 *
 * The split happens per column. Order in `dsl` follows
 * `Object.entries(model)` insertion order. An empty model yields
 * `{ dsl: "", extra: {} }`.
 */
export const partitionFilterModel = (
  model: FilterModel | null | undefined,
  toDsl: FilterEntryToDsl
): { dsl: string; extra: FilterModel } => {
  if (!model) return { dsl: "", extra: {} };
  const dslParts: string[] = [];
  const extra: FilterModel = {};
  for (const [colId, entry] of Object.entries(model)) {
    const rendered = toDsl(colId, entry);
    if (rendered === null) {
      extra[colId] = entry;
    } else if (rendered.length > 0) {
      dslParts.push(rendered);
    }
  }
  return { dsl: dslParts.join(" and "), extra };
};

// ---------------------------------------------------------------------------
// Legacy persisted-shape fallback
// ---------------------------------------------------------------------------

/**
 * Pre-refactor `samplesListState.byScope.logViewSamples` shape. After
 * the refactor lands, persisted state from before that point can still
 * appear (transient host storage may retain a pre-refactor object). We
 * read it via `legacyToView` and write the new shape back on the next
 * user action.
 */
export interface LegacyScopeState {
  columnVisibility?: Record<string, boolean>;
  gridState?: GridState;
}

/**
 * Read a pre-refactor scope slot plus the parallel DSL string from the
 * old `state.log.filter` field, and synthesize a fresh `SamplesViewState`.
 * Empty / missing inputs round-trip to `defaultSamplesView()`.
 */
export const legacyToView = (
  slot: LegacyScopeState | undefined | null,
  dslFilter: string | undefined | null
): SamplesViewState => {
  const base = defaultSamplesView();
  const grid = slot?.gridState;

  const orderedColIds = grid?.columnOrder?.orderedColIds ?? [];
  const visibilityMap = slot?.columnVisibility ?? {};
  const visibilityKeys = Object.keys(visibilityMap);
  const hiddenColIds = new Set(grid?.columnVisibility?.hiddenColIds ?? []);

  // Columns: ag-grid order first, then any visibility-map keys not yet in
  // the order list (preserving authored order from the legacy map).
  const orderedFromGrid = orderedColIds.map((id) => ({
    id,
    visible: id in visibilityMap ? visibilityMap[id] : !hiddenColIds.has(id),
  }));
  const trailingFromMap = visibilityKeys
    .filter((id) => !orderedColIds.includes(id))
    .map((id) => ({ id, visible: visibilityMap[id] }));
  const columns = [...orderedFromGrid, ...trailingFromMap];

  const sort = (grid?.sort?.sortModel ?? []).map((s) => ({
    colId: s.colId,
    dir: s.sort,
  }));

  // Old persistence didn't split DSL vs extras; treat the whole model as
  // extras, since we can't introspect the registry here. Phase 2's read
  // boundary re-partitions via `partitionFilterModel` after the registry
  // is available. The DSL field comes from the old state.log.filter.
  const extraColumnFilters: FilterModel = {
    ...(grid?.filter?.filterModel ?? {}),
  };

  return {
    ...base,
    columns: columns.length > 0 ? columns : base.columns,
    sort,
    filters: { dsl: dslFilter ?? "", extraColumnFilters },
  };
};
