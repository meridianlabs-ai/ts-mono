import type { ColDef, GridState } from "ag-grid-community";
import { useCallback, useEffect, useMemo } from "react";

import { useStore } from "../../../state/store";
import { getFieldKey } from "../../shared/gridUtils";
import { type WireScoreColorScale } from "../../shared/samples-grid/colorScale";

import { type SamplesViewState } from "./samplesView";
import {
  gridStateToView,
  liftEvalView,
  pickActiveView,
  resolveSamplesView,
  viewToGridState,
} from "./samplesView.converters";

/** Just the resolved `multiline` — for callers that need it before
 *  computing `allColumns` (which the full hook requires). */
export function useSamplesViewMultiline(): boolean {
  const stored = useStore(
    (state) => state.logs.samplesListState.byScope.logViewSamples.view
  );
  const evalDefaultField = useStore(
    (state) =>
      state.log.selectedLogDetails?.eval.viewer?.task_samples_view ?? null
  );
  return useMemo(() => {
    const evalDefault = pickActiveView(evalDefaultField);
    return resolveSamplesView(stored, evalDefault).multiline;
  }, [stored, evalDefaultField]);
}

/** Eval-author-supplied score-label overrides. Read straight from
 *  the wire (no persistence) so a user's stored view from a prior
 *  eval can't shadow the current eval's labels. Returns an empty
 *  object when no overrides are present. */
export function useSamplesViewScoreLabels(): Record<string, string> {
  const evalDefaultField = useStore(
    (state) =>
      state.log.selectedLogDetails?.eval.viewer?.task_samples_view ?? null
  );
  return useMemo(() => {
    const evalDefault = pickActiveView(evalDefaultField);
    return evalDefault?.score_labels ?? {};
  }, [evalDefaultField]);
}

/** Eval-author-supplied score-cell colour scales. Same wire-only
 *  access pattern as `useSamplesViewScoreLabels` — never lifted into
 *  the persisted runtime state, so colour scales from a prior eval
 *  can't bleed into the current one. */
export function useSamplesViewScoreColorScales(): Record<
  string,
  WireScoreColorScale
> {
  const evalDefaultField = useStore(
    (state) =>
      state.log.selectedLogDetails?.eval.viewer?.task_samples_view ?? null
  );
  return useMemo(() => {
    const evalDefault = pickActiveView(evalDefaultField);
    return (evalDefault?.score_color_scales ?? {}) as Record<
      string,
      WireScoreColorScale
    >;
  }, [evalDefaultField]);
}

/** Resolved `colorScalesEnabled` — same access pattern as the
 *  multiline companion above. Read in `SamplesTab` so the columns
 *  builder can decide whether to attach a `cellStyle` callback. */
export function useSamplesViewColorScalesEnabled(): boolean {
  const stored = useStore(
    (state) => state.logs.samplesListState.byScope.logViewSamples.view
  );
  const evalDefaultField = useStore(
    (state) =>
      state.log.selectedLogDetails?.eval.viewer?.task_samples_view ?? null
  );
  return useMemo(() => {
    const evalDefault = pickActiveView(evalDefaultField);
    return resolveSamplesView(stored, evalDefault).colorScalesEnabled;
  }, [stored, evalDefaultField]);
}

/** Resolved `compactScores` — same access pattern as the multiline
 *  companion above. Read in `SamplesTab` before columns are built so
 *  the flag can flow into `buildSampleColumns`. */
export function useSamplesViewCompactScores(): boolean {
  const stored = useStore(
    (state) => state.logs.samplesListState.byScope.logViewSamples.view
  );
  const evalDefaultField = useStore(
    (state) =>
      state.log.selectedLogDetails?.eval.viewer?.task_samples_view ?? null
  );
  return useMemo(() => {
    const evalDefault = pickActiveView(evalDefaultField);
    return resolveSamplesView(stored, evalDefault).compactScores;
  }, [stored, evalDefaultField]);
}

export interface UseSamplesViewResult {
  view: SamplesViewState;
  columnVisibility: Record<string, boolean>;
  gridState: GridState | undefined;
  setView: (next: SamplesViewState) => void;
  patchView: (partial: Partial<SamplesViewState>) => void;
  setColumnVisibility: (visibility: Record<string, boolean>) => void;
  setGridState: (gs: GridState) => void;
  setMultiline: (multiline: boolean) => void;
  setCompactScores: (compactScores: boolean) => void;
  setColorScalesEnabled: (enabled: boolean) => void;
  /** Reset just the column list (order + visibility) to the
   *  eval-author default (when present) or the built-in seeded
   *  default. Sort, filter, multiline, and compactScores are left
   *  alone. */
  resetColumns: () => void;
}

/**
 * Window onto the SampleList scope's `SamplesView` descriptor. Resolves
 * stored > eval-author default > built-in default; seeds visibility for
 * unseeded columns; folds ag-grid `GridState` updates back into the view.
 *
 * Selected-scores projection (the `score__*` ↔ `selectedScores` split)
 * stays in `SamplesTab` for now.
 */
export function useSamplesView<TRow>(
  allColumns?: ColDef<TRow>[],
  options?: {
    seedDefaultVisibility?: (col: ColDef<TRow>) => boolean;
  }
): UseSamplesViewResult {
  const { seedDefaultVisibility } = options ?? {};

  const stored = useStore(
    (state) => state.logs.samplesListState.byScope.logViewSamples.view
  );
  const evalDefaultField = useStore(
    (state) =>
      state.log.selectedLogDetails?.eval.viewer?.task_samples_view ?? null
  );
  const setSampleListView = useStore(
    (state) => state.logsActions.setSampleListView
  );

  const availableColIds = useMemo(() => {
    const ids = new Set<string>();
    if (allColumns) {
      for (const col of allColumns) ids.add(getFieldKey(col));
    }
    return ids;
  }, [allColumns]);

  const evalDefault = useMemo(
    () => pickActiveView(evalDefaultField),
    [evalDefaultField]
  );

  const view = useMemo(
    () => resolveSamplesView(stored, evalDefault),
    [stored, evalDefault]
  );

  const columnVisibility = useMemo<Record<string, boolean>>(() => {
    const v: Record<string, boolean> = {};
    for (const col of view.columns) v[col.id] = col.visible;
    return v;
  }, [view.columns]);

  const gridState = useMemo(
    () => (allColumns ? viewToGridState(view, availableColIds) : undefined),
    [allColumns, view, availableColIds]
  );

  // Seeding writes the resolved view (not just the diff) so eval-author
  // defaults for sort/filter/multiline land in the stored slot the first
  // time we encounter a new column.
  useEffect(() => {
    if (!allColumns || !seedDefaultVisibility) return;
    const known = new Set(view.columns.map((c) => c.id));
    const additions: SamplesViewState["columns"] = [];
    for (const col of allColumns) {
      const id = getFieldKey(col);
      if (!known.has(id)) {
        additions.push({ id, visible: seedDefaultVisibility(col) });
      }
    }
    if (additions.length === 0) return;
    setSampleListView({ ...view, columns: [...view.columns, ...additions] });
  }, [allColumns, view, seedDefaultVisibility, setSampleListView]);

  const patchView = useCallback(
    (partial: Partial<SamplesViewState>) => {
      setSampleListView({ ...view, ...partial });
    },
    [view, setSampleListView]
  );

  const setColumnVisibility = useCallback(
    (visibility: Record<string, boolean>) => {
      const seen = new Set<string>();
      const nextColumns: SamplesViewState["columns"] = [];
      for (const c of view.columns) {
        nextColumns.push(
          c.id in visibility ? { id: c.id, visible: visibility[c.id] } : c
        );
        seen.add(c.id);
      }
      for (const [id, visible] of Object.entries(visibility)) {
        if (!seen.has(id)) nextColumns.push({ id, visible });
      }
      patchView({ columns: nextColumns });
    },
    [view.columns, patchView]
  );

  const setGridState = useCallback(
    (gs: GridState) => {
      setSampleListView(gridStateToView(view, gs, availableColIds));
    },
    [view, availableColIds, setSampleListView]
  );

  const setMultiline = useCallback(
    (multiline: boolean) => patchView({ multiline }),
    [patchView]
  );

  const setCompactScores = useCallback(
    (compactScores: boolean) => patchView({ compactScores }),
    [patchView]
  );

  const setColorScalesEnabled = useCallback(
    (colorScalesEnabled: boolean) => patchView({ colorScalesEnabled }),
    [patchView]
  );

  const setView = useCallback(
    (next: SamplesViewState) => setSampleListView(next),
    [setSampleListView]
  );

  const resetColumns = useCallback(() => {
    if (!allColumns) return;
    // Resolve the eval-author default's column list (if any). Each
    // entry is `{ id, visible }`. Anything in `allColumns` that
    // isn't covered by the eval default falls through to the
    // caller-supplied seed (the same predicate `useEffect` uses to
    // initialize new columns).
    const evalCols = liftEvalView(evalDefault).columns;
    const evalMap = new Map(evalCols.map((c) => [c.id, c.visible]));
    const nextColumns: SamplesViewState["columns"] = allColumns.map((col) => {
      const id = getFieldKey(col);
      if (evalMap.has(id)) return { id, visible: evalMap.get(id)! };
      return {
        id,
        visible: seedDefaultVisibility ? seedDefaultVisibility(col) : true,
      };
    });
    patchView({ columns: nextColumns });
  }, [allColumns, evalDefault, seedDefaultVisibility, patchView]);

  return {
    view,
    columnVisibility,
    gridState,
    setView,
    patchView,
    setColumnVisibility,
    setGridState,
    setMultiline,
    setCompactScores,
    setColorScalesEnabled,
    resetColumns,
  };
}
