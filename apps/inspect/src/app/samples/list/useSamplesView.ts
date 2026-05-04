import type { ColDef, GridState } from "ag-grid-community";
import { useCallback, useEffect, useMemo } from "react";

import { useStore } from "../../../state/store";
import { getFieldKey } from "../../shared/gridUtils";

import {
  gridStateToView,
  pickActiveView,
  resolveSamplesView,
  viewToGridState,
} from "./samplesView.converters";
import { type SamplesViewState } from "./samplesView";

/** Just the resolved `multiline` — for callers that need it before
 *  computing `allColumns` (which the full hook requires). */
export function useSamplesViewMultiline(): boolean {
  const stored = useStore(
    (state) => state.logs.samplesListState.byScope.logViewSamples.view,
  );
  const evalDefaultField = useStore(
    (state) =>
      state.log.selectedLogDetails?.eval.viewer?.task_samples_view ?? null,
  );
  return useMemo(() => {
    const evalDefault = pickActiveView(evalDefaultField);
    return resolveSamplesView(stored, evalDefault).multiline;
  }, [stored, evalDefaultField]);
}

/** Resolved `compactScores` — same access pattern as the multiline
 *  companion above. Read in `SamplesTab` before columns are built so
 *  the flag can flow into `buildSampleColumns`. */
export function useSamplesViewCompactScores(): boolean {
  const stored = useStore(
    (state) => state.logs.samplesListState.byScope.logViewSamples.view,
  );
  const evalDefaultField = useStore(
    (state) =>
      state.log.selectedLogDetails?.eval.viewer?.task_samples_view ?? null,
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
  },
): UseSamplesViewResult {
  const { seedDefaultVisibility } = options ?? {};

  const stored = useStore(
    (state) => state.logs.samplesListState.byScope.logViewSamples.view,
  );
  const evalDefaultField = useStore(
    (state) =>
      state.log.selectedLogDetails?.eval.viewer?.task_samples_view ?? null,
  );
  const setSampleListView = useStore(
    (state) => state.logsActions.setSampleListView,
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
    [evalDefaultField],
  );

  const view = useMemo(
    () => resolveSamplesView(stored, evalDefault),
    [stored, evalDefault],
  );

  const columnVisibility = useMemo<Record<string, boolean>>(() => {
    const v: Record<string, boolean> = {};
    for (const col of view.columns) v[col.id] = col.visible;
    return v;
  }, [view.columns]);

  const gridState = useMemo(
    () => (allColumns ? viewToGridState(view, availableColIds) : undefined),
    [allColumns, view, availableColIds],
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
    [view, setSampleListView],
  );

  const setColumnVisibility = useCallback(
    (visibility: Record<string, boolean>) => {
      const seen = new Set<string>();
      const nextColumns: SamplesViewState["columns"] = [];
      for (const c of view.columns) {
        nextColumns.push(
          c.id in visibility ? { id: c.id, visible: visibility[c.id] } : c,
        );
        seen.add(c.id);
      }
      for (const [id, visible] of Object.entries(visibility)) {
        if (!seen.has(id)) nextColumns.push({ id, visible });
      }
      patchView({ columns: nextColumns });
    },
    [view.columns, patchView],
  );

  const setGridState = useCallback(
    (gs: GridState) => {
      setSampleListView(gridStateToView(view, gs, availableColIds));
    },
    [view, availableColIds, setSampleListView],
  );

  const setMultiline = useCallback(
    (multiline: boolean) => patchView({ multiline }),
    [patchView],
  );

  const setCompactScores = useCallback(
    (compactScores: boolean) => patchView({ compactScores }),
    [patchView],
  );

  const setView = useCallback(
    (next: SamplesViewState) => setSampleListView(next),
    [setSampleListView],
  );

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
  };
}
