import type { ColDef } from "ag-grid-community";
import type { AgGridReact } from "ag-grid-react";
import { RefObject, useCallback, useEffect } from "react";

import { getFieldKey } from "./gridUtils";

/**
 * Applies a `Record<colId, visible>` map to an ag-grid instance via
 * `api.applyColumnState`. Used in place of putting `hide:` on each
 * `ColDef` so that visibility changes don't force a `columnDefs`
 * reference change — which would reset user-driven width and order.
 *
 * The hook fires the apply both on the dep change (visibility,
 * columnDefs) and once more from the returned callback. Callers should
 * invoke that callback from their `onGridReady` handler so the very
 * first apply (which runs before the api exists) gets retried.
 *
 * Both the seed/lookup and the `applyColumnState` colId use
 * `getFieldKey` so the two stay in lockstep across columns that set
 * only `colId` (e.g. the pinned `#` index column).
 */
export function useApplyColumnVisibility<TRow>(
  gridRef: RefObject<AgGridReact<TRow> | null>,
  columnDefs: ColDef<TRow>[],
  visibility: Record<string, boolean> | undefined
): () => void {
  const apply = useCallback(() => {
    const api = gridRef.current?.api;
    if (!api || !visibility) return;
    const state = columnDefs.map((c) => {
      const id = getFieldKey(c);
      return { colId: id, hide: visibility[id] === false };
    });
    if (state.length > 0) api.applyColumnState({ state });
  }, [gridRef, columnDefs, visibility]);

  useEffect(() => {
    apply();
  }, [apply]);

  return apply;
}
