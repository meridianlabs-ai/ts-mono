import type { ColumnResizedEvent } from "ag-grid-community";
import type { AgGridReact } from "ag-grid-react";
import { RefObject, useCallback, useRef } from "react";

import { debounce } from "@tsmono/util";

const kRefitDebounceMs = 10;

export interface GridColumnRefit<TRow> {
  /** Debounced `api.sizeColumnsToFit()`. Becomes a no-op for the lifetime
   *  of the grid instance once the user manually resizes any column. */
  refitColumns: () => void;
  /** Wire to `AgGridReact.onColumnResized` so user drags are detected. */
  handleColumnResized: (e: ColumnResizedEvent<TRow>) => void;
}

// ag-grid `columnResized` event sources that mean "the user sized this
// column themselves". `"uiColumnResized"` is a resize-handle drag;
// `"autosizeColumns"` is what ag-grid (34.x) dispatches on the public
// event for a resize-handle double-click autosize (the internal
// `"uiColumnResized"` source it passes down only surfaces on the
// column-scoped `widthChanged` event, not here). Both are direct
// interactions with the resize handle in our config — we never call
// `api.autoSizeColumns`, and our `fitGridWidth` strategy routes through
// `sizeColumnsToFitGridBody`, not the autosize path — so neither can be
// triggered programmatically. Grid-initiated sources (`"sizeColumnsToFit"`,
// `"flex"`, `"api"`, ...) are intentionally absent.
const kUserResizeSources: ReadonlySet<string> = new Set([
  "uiColumnResized",
  "autosizeColumns",
]);

/**
 * Auto-fit columns to the grid width, deferring to the user.
 *
 * `sizeColumnsToFit` is wholesale: it redistributes every column, wiping
 * any width the user dragged. Callers re-fit when columns appear or the
 * viewport resizes — but once the user has manually sized a column they
 * have taken control of the layout, so all subsequent auto-fits are
 * suppressed (until the grid remounts, e.g. on a scope change). The guard
 * is checked when the debounce fires, so a fit already pending when the
 * user starts dragging is suppressed too.
 */
export function useGridColumnRefit<TRow>(
  gridRef: RefObject<AgGridReact<TRow> | null>
): GridColumnRefit<TRow> {
  const userResizedRef = useRef(false);
  // Lazily created on first use: creating it during render would pass the
  // grid ref into non-React code, and the single instance must survive
  // re-renders so the debounce timer isn't reset.
  const resizerRef = useRef<(() => void) | null>(null);

  const handleColumnResized = useCallback((e: ColumnResizedEvent<TRow>) => {
    if (kUserResizeSources.has(e.source)) {
      userResizedRef.current = true;
    }
  }, []);

  const refitColumns = useCallback(() => {
    if (userResizedRef.current) return;
    resizerRef.current ??= debounce(() => {
      if (userResizedRef.current) return;
      gridRef.current?.api?.sizeColumnsToFit();
    }, kRefitDebounceMs);
    resizerRef.current();
  }, [gridRef]);

  return { refitColumns, handleColumnResized };
}
