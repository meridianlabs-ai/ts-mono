/**
 * Pure converters between the on-the-wire `TaskSamplesView`, the runtime
 * `SamplesViewState`, and ag-grid's `GridState`.
 *
 * No runtime imports — every function here is referentially transparent
 * given its inputs, so unit tests can exercise them in isolation. Phase 2
 * wires these into the SampleList store + hook.
 */
import type { SortingState } from "@tanstack/react-table";
import type { FilterModel, GridState } from "ag-grid-community";

import type { TaskSamplesView } from "@tsmono/inspect-common/types";

import { defaultSamplesView, type SamplesViewState } from "./samplesView";

// ---------------------------------------------------------------------------
// Runtime ↔ TanStack SortingState
// ---------------------------------------------------------------------------

/** `view.sort` → TanStack `SortingState` (the grid's controlled sort). */
export const viewSortToSorting = (
  sort: SamplesViewState["sort"]
): SortingState => sort.map((s) => ({ id: s.colId, desc: s.dir === "desc" }));

/** TanStack `SortingState` → `view.sort` (the persisted descriptor). */
export const sortingToViewSort = (
  sorting: SortingState
): SamplesViewState["sort"] =>
  sorting.map((s) => ({ colId: s.id, dir: s.desc ? "desc" : "asc" }));

// ---------------------------------------------------------------------------
// Wire ↔ runtime
// ---------------------------------------------------------------------------

/**
 * Lift a wire `TaskSamplesView` into the runtime `SamplesViewState`.
 *
 * - Nullable wire fields collapse to defaults from `defaultSamplesView()`.
 * - Sort entries map `column` → `colId` to match ag-grid naming on the
 *   runtime side. Wire form keeps `column` to match the Python field.
 * - `extraColumnFilters` starts empty; ag-grid filterModel residue is
 *   only synthesized at runtime when the user sets column-header filters
 *   the DSL can't express.
 */
export const liftEvalView = (
  wire: TaskSamplesView | undefined | null
): SamplesViewState => {
  const fallback = defaultSamplesView();
  if (!wire) return fallback;
  return {
    name: wire.name,
    // Wire views written before `visible` / `dir` had server-side defaults
    // can omit them despite the generated type.
    columns: wire.columns
      ? wire.columns.map((c) => ({
          id: c.id,
          visible: (c.visible as boolean | null | undefined) ?? true,
        }))
      : fallback.columns,
    sort: wire.sort
      ? wire.sort.map((s) => ({
          colId: s.column,
          dir: (s.dir as "asc" | "desc" | null | undefined) ?? "asc",
        }))
      : fallback.sort,
    filters: { dsl: "", extraColumnFilters: {} },
    multiline: wire.multiline ?? fallback.multiline,
    compactScores: wire.compact_scores ?? fallback.compactScores,
    colorScalesEnabled:
      wire.color_scales_enabled ?? fallback.colorScalesEnabled,
    userOverrides: {},
  };
};

/**
 * Flatten a runtime state back to its wire shape. `extraColumnFilters` is
 * dropped — that field is TS-only and never crosses the wire. Used to
 * compare a stored view against an eval default for override detection.
 */
export const flattenToEvalView = (
  state: SamplesViewState
): TaskSamplesView => ({
  name: state.name,
  columns: state.columns.map((c) => ({ id: c.id, visible: c.visible })),
  sort: state.sort.map((s) => ({ column: s.colId, dir: s.dir })),
  multiline: state.multiline,
  compact_scores: state.compactScores,
  color_scales_enabled: state.colorScalesEnabled,
});

/**
 * `task_samples_view` may be a single view, a list of views, or absent.
 * For Phase 0–2 we honour only the first entry of a list.
 */
export const pickActiveView = (
  field: TaskSamplesView | TaskSamplesView[] | undefined | null
): TaskSamplesView | undefined => {
  if (!field) return undefined;
  if (Array.isArray(field)) return field[0];
  return field;
};

/**
 * Resolution priority: stored (user-modified runtime state) > eval default
 * (lifted from `eval.viewer.task_samples_view`) > built-in default.
 *
 * Per-field exception for the toolbar toggles (`multiline`, `compactScores`,
 * `colorScalesEnabled`): stored only wins if `userOverrides` records that
 * the user has actually flipped that toggle. Otherwise the eval-author
 * default takes precedence even when stored state already exists, so an
 * eval that ships e.g. `color_scales_enabled: false` isn't shadowed by a
 * stale `true` lifted from a previous eval.
 */
export const resolveSamplesView = (
  // Persisted slots written before `userOverrides` landed lack the field,
  // so accept it as absent here even though the runtime type requires it.
  stored:
    | (Omit<SamplesViewState, "userOverrides"> &
        Partial<Pick<SamplesViewState, "userOverrides">>)
    | undefined,
  evalDefault: TaskSamplesView | undefined | null
): SamplesViewState => {
  if (!stored) return liftEvalView(evalDefault);
  const lifted = liftEvalView(evalDefault);
  const overrides = stored.userOverrides ?? {};
  return {
    ...stored,
    userOverrides: overrides,
    multiline: overrides.multiline ?? lifted.multiline,
    compactScores: overrides.compactScores ?? lifted.compactScores,
    colorScalesEnabled:
      overrides.colorScalesEnabled ?? lifted.colorScalesEnabled,
  };
};

// ---------------------------------------------------------------------------
// Runtime ↔ ag-grid GridState
// ---------------------------------------------------------------------------

/**
 * Project the runtime descriptor into the `GridState` ag-grid consumes.
 *
 * Column-id tolerance handles transient mismatches between a per-log
 * descriptor and its log's columns — e.g. samples loading in stages where
 * `allColumns` initially lacks scorer columns the user has customized.
 * Unknown ids are excluded from the emitted GridState but preserved
 * unchanged in the source descriptor.
 *
 * The DSL filter is intentionally *not* materialized into `filterModel`
 * here — that translation needs the live filter registry, which only
 * exists at runtime. `useSamplesView` layers the DSL→model translation
 * on top of this base GridState.
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
  const widths = view.columnWidths ?? {};
  const columnSizingModel = Object.entries(widths)
    .filter(([colId]) => availableColIds.has(colId))
    .map(([colId, width]) => ({ colId, width }));
  return {
    // Flag this as a *partial* column state. Without it ag-grid (34.x)
    // applies the restore with `defaultState.flex = null`, which strips
    // the colDef `initialFlex` off input/target/answer so they freeze at
    // their fixed fallback width instead of filling the grid. The same
    // reset also fires whenever a `columnSizing` facet is present — even
    // an empty one — so we omit that facet entirely until the user has
    // actually resized a column.
    partialColumnState: true,
    columnVisibility: {
      hiddenColIds: knownColumns.filter((c) => !c.visible).map((c) => c.id),
    },
    columnOrder: { orderedColIds: knownColumns.map((c) => c.id) },
    ...(columnSizingModel.length > 0
      ? { columnSizing: { columnSizingModel } }
      : {}),
    sort: { sortModel },
    filter: { filterModel },
  };
};

/**
 * Fold a fresh ag-grid `GridState` back into the runtime descriptor,
 * preserving any unknown-id references from `prev`. Unknown ids occur
 * during transient column-load mismatches (e.g. user refreshes a log,
 * a write fires before scorer columns reappear); preservation keeps the
 * user's customizations alive across those frames.
 *
 * Updates `columns`, `sort`, and `filters.extraColumnFilters`. The `dsl`
 * half of `filters` is the responsibility of the caller — it comes from
 * a different signal (the toolbar text) and is partitioned via
 * `partitionFilterModel`.
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

  // Widths: capture fresh values for known columns and preserve any
  // recorded under transient unknown ids (samples still loading).
  // Flex-only entries (no `width`) don't represent a user resize.
  const prevWidths = prev.columnWidths ?? {};
  const knownWidths: Record<string, number> = {};
  for (const entry of gridState.columnSizing?.columnSizingModel ?? []) {
    if (availableColIds.has(entry.colId) && typeof entry.width === "number") {
      knownWidths[entry.colId] = entry.width;
    }
  }
  const unknownWidths = Object.fromEntries(
    Object.entries(prevWidths).filter(([colId]) => !availableColIds.has(colId))
  );
  const mergedWidths = { ...unknownWidths, ...knownWidths };

  return {
    ...prev,
    columns: [...knownColumns, ...unknownColumns],
    sort: [...knownSort, ...unknownSort],
    filters: {
      dsl: prev.filters.dsl,
      extraColumnFilters: { ...knownExtras, ...unknownExtras },
    },
    columnWidths:
      Object.keys(mergedWidths).length > 0 ? mergedWidths : undefined,
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
  columns: view.columns.map((c) => {
    const nextVisible = visibility[c.id];
    return nextVisible !== undefined ? { ...c, visible: nextVisible } : c;
  }),
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
      // ag-grid's FilterModel types its entry values as `any`.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
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
 * Pre-refactor scope state from before the TaskSamplesView descriptor
 * existed (gridState + columnVisibility in one bag). Kept as a converter
 * for safety; no live caller reads from this slot today — the per-log
 * refactor migrates older state via the persist `migrate` hook instead.
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
    visible: visibilityMap[id] ?? !hiddenColIds.has(id),
  }));
  const trailingFromMap = visibilityKeys
    .filter((id) => !orderedColIds.includes(id))
    .map((id) => ({ id, visible: visibilityMap[id] ?? false }));
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
