import type {
  CellMouseDownEvent,
  ColDef,
  ColumnResizedEvent,
  GetRowIdParams,
  GridApi,
  GridColumnsChangedEvent,
  GridState,
  IRowNode,
  RowClickedEvent,
  SizeColumnsToContentStrategy,
  SizeColumnsToFitGridStrategy,
  SizeColumnsToFitProvidedWidthStrategy,
  StateUpdatedEvent,
} from "ag-grid-community";
import { themeBalham } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import clsx from "clsx";
import {
  ReactElement,
  RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";

import "../agGrid";

import { createGridKeyboardHandler } from "../gridKeyboardNavigation";
import { createGridColumnResizer } from "../gridUtils";

import styles from "./SamplesGrid.module.css";

type AutoSizeStrategy =
  | SizeColumnsToFitGridStrategy
  | SizeColumnsToFitProvidedWidthStrategy
  | SizeColumnsToContentStrategy;

export type SamplesGridViewMode = "list" | "grid";

const kListModeRowHeight = 88;
const kGridModeRowHeight = 30;

const rowHeightForMode = (mode: SamplesGridViewMode): number =>
  mode === "list" ? kListModeRowHeight : kGridModeRowHeight;

interface SamplesGridProps<TRow> {
  rowData: TRow[];
  columnDefs: ColDef<TRow>[];
  defaultColDef?: ColDef<TRow>;
  viewMode: SamplesGridViewMode;
  rowHeight?: number;

  getRowId: (params: GetRowIdParams<TRow>) => string;
  /** Row id that should be selected and scrolled into view. */
  selectedRowId?: string;

  onRowOpen: (
    row: TRow,
    opts: { newWindow: boolean; via: "click" | "key" }
  ) => void;

  /** Auto-scroll to bottom as new rows arrive while this is true. */
  followOutput?: boolean;
  /** Receives the `.ag-body-viewport` once the grid is ready. */
  scrollRef?: RefObject<HTMLDivElement | null>;

  /** Side effects after the grid first renders data. */
  onFirstDataRendered?: (api: GridApi<TRow>) => void;

  /** Optional grid-state persistence. */
  initialState?: GridState;
  onStateUpdated?: (state: GridState) => void;
  onFilterChanged?: (api: GridApi<TRow>) => void;

  loading?: boolean;

  /** Opt-in: auto-size columns to fit (used by grid mode where columns
   *  declare fixed widths rather than flex). */
  autoSizeStrategy?: AutoSizeStrategy;
  /** When true, refit columns on viewport resize and when new columns
   *  appear (e.g. after score-column discovery). Pairs with
   *  `autoSizeStrategy`. */
  refitOnSizeChange?: boolean;

  gridRef?: RefObject<AgGridReact<TRow> | null>;
  className?: string;
}

const makeKeyboardHandler = <TRow,>(
  gridRef: RefObject<AgGridReact<TRow> | null>,
  onRowOpen: SamplesGridProps<TRow>["onRowOpen"]
) =>
  createGridKeyboardHandler<TRow>({
    gridRef,
    onOpenRow: (rowNode: IRowNode<TRow>, e: KeyboardEvent) => {
      if (rowNode.data) {
        const newWindow = e.metaKey || e.ctrlKey || e.shiftKey;
        onRowOpen(rowNode.data, { newWindow, via: "key" });
      }
    },
  });

export const SamplesGrid = <TRow,>(
  props: SamplesGridProps<TRow>
): ReactElement => {
  const {
    rowData,
    columnDefs,
    defaultColDef,
    viewMode,
    rowHeight,
    getRowId,
    selectedRowId,
    onRowOpen,
    followOutput = false,
    scrollRef,
    onFirstDataRendered,
    initialState,
    onStateUpdated,
    onFilterChanged,
    loading,
    autoSizeStrategy,
    refitOnSizeChange = false,
    gridRef: externalGridRef,
    className,
  } = props;

  const internalGridRef = useRef<AgGridReact<TRow>>(null);
  const gridRef = externalGridRef ?? internalGridRef;
  const gridContainerRef = useRef<HTMLDivElement>(null);

  // Focus the grid container on mount so keyboard nav works without a click.
  useEffect(() => {
    gridContainerRef.current?.focus();
  }, []);

  // Keyboard nav.
  const handleKeyDown = useMemo(
    () => makeKeyboardHandler(gridRef, onRowOpen),
    [gridRef, onRowOpen]
  );
  useEffect(() => {
    const el = gridContainerRef.current;
    if (!el) return;
    el.addEventListener("keydown", handleKeyDown);
    return () => el.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Row click → select + open. Modifier keys / middle button open in new window.
  const handleRowClick = useCallback(
    (e: RowClickedEvent<TRow>) => {
      if (!e.data || !e.node || !gridRef.current?.api) return;
      gridRef.current.api.deselectAll();
      e.node.setSelected(true);
      const me = e.event as MouseEvent | undefined;
      const newWindow = !!(
        me?.metaKey ||
        me?.ctrlKey ||
        me?.shiftKey ||
        me?.button === 1
      );
      onRowOpen(e.data, { newWindow, via: "click" });
    },
    [gridRef, onRowOpen]
  );

  const handleCellMouseDown = useCallback(
    (e: CellMouseDownEvent<TRow>) => {
      const me = e.event as MouseEvent | undefined;
      if (me?.button === 1 && e.data) {
        me.preventDefault();
        onRowOpen(e.data, { newWindow: true, via: "click" });
      }
    },
    [onRowOpen]
  );

  // Highlight + scroll to the externally selected row when it changes.
  const selectExternalRow = useCallback(() => {
    if (!gridRef.current?.api || !selectedRowId) return;
    const node = gridRef.current.api.getRowNode(selectedRowId);
    if (node) {
      gridRef.current.api.deselectAll();
      node.setSelected(true);
      gridRef.current.api.ensureNodeVisible(node, "middle");
    }
  }, [gridRef, selectedRowId]);
  useEffect(() => {
    selectExternalRow();
  }, [selectExternalRow]);

  // Follow-output: auto-scroll to bottom as new rows arrive while running.
  // The "user has scrolled away" detection lives in `onBodyScroll`.
  const followingRef = useRef(followOutput);
  const prevCountRef = useRef(rowData.length);
  useEffect(() => {
    if (followOutput) followingRef.current = true;
  }, [followOutput]);
  useEffect(() => {
    if (
      followOutput &&
      followingRef.current &&
      rowData.length > prevCountRef.current &&
      gridRef.current?.api
    ) {
      gridRef.current.api.ensureIndexVisible(rowData.length - 1, "bottom");
    }
    prevCountRef.current = rowData.length;
  }, [rowData.length, followOutput, gridRef]);

  // When followOutput transitions from true → false (eval finished), scroll
  // to top so the user starts at the beginning of the now-static list.
  const prevFollowRef = useRef(followOutput);
  useEffect(() => {
    if (!followOutput && prevFollowRef.current && gridRef.current?.api) {
      followingRef.current = false;
      setTimeout(() => {
        gridRef.current?.api?.ensureIndexVisible(0, "top");
      }, 100);
    }
    prevFollowRef.current = followOutput;
  }, [followOutput, gridRef]);

  const effectiveRowHeight = rowHeight ?? rowHeightForMode(viewMode);

  const handleBodyScroll = useCallback(() => {
    if (!followOutput || !gridRef.current?.api) return;
    const api = gridRef.current.api;
    const v = api.getVerticalPixelRange();
    const totalH = api.getDisplayedRowCount() * effectiveRowHeight;
    const viewportH = v.bottom - v.top;
    followingRef.current = v.bottom >= totalH - viewportH * 0.1;
  }, [followOutput, gridRef, effectiveRowHeight]);

  // Track which columns the user manually resized; for non-resized flex
  // columns we keep re-applying their flex so they share remaining space.
  const manuallyResized = useRef(new Set<string>());
  const handleColumnResized = useCallback(
    (event: ColumnResizedEvent<TRow>) => {
      if (
        !event.finished ||
        event.source !== "uiColumnResized" ||
        !event.column
      )
        return;
      manuallyResized.current.add(event.column.getColId());
      const state = columnDefs
        .filter(
          (c) => c.colId && c.flex && !manuallyResized.current.has(c.colId)
        )
        .map((c) => ({ colId: c.colId!, flex: c.flex }));
      if (state.length > 0) {
        gridRef.current?.api?.applyColumnState({ state });
      }
    },
    [columnDefs, gridRef]
  );

  const handleStateUpdated = useCallback(
    (e: StateUpdatedEvent<TRow>) => {
      onStateUpdated?.(e.state);
    },
    [onStateUpdated]
  );

  const handleFilterChanged = useCallback(() => {
    if (gridRef.current?.api) onFilterChanged?.(gridRef.current.api);
  }, [gridRef, onFilterChanged]);

  // Re-fit columns when the grid is resized or new columns appear
  // (e.g. score columns discovered on first data load). Only active when
  // `refitOnSizeChange` is set.
  const refitColumns = useRef(createGridColumnResizer(gridRef)).current;
  const maxColCount = useRef(0);
  const handleGridColumnsChanged = useCallback(
    (e: GridColumnsChangedEvent<TRow>) => {
      if (!refitOnSizeChange) return;
      const cols = e.api.getColumnDefs();
      if (cols && cols.length > maxColCount.current) {
        maxColCount.current = cols.length;
        refitColumns();
      }
    },
    [refitOnSizeChange, refitColumns]
  );
  const handleGridSizeChanged = useCallback(() => {
    if (refitOnSizeChange) refitColumns();
  }, [refitOnSizeChange, refitColumns]);
  // Refit when columnDefs themselves change (column hide/show via prop).
  useEffect(() => {
    if (refitOnSizeChange) refitColumns();
  }, [columnDefs, refitOnSizeChange, refitColumns]);

  const handleGridReady = useCallback(() => {
    if (scrollRef) {
      const viewport = gridContainerRef.current?.querySelector(
        ".ag-body-viewport"
      ) as HTMLDivElement | null;
      scrollRef.current = viewport ?? null;
    }
  }, [scrollRef]);

  const handleFirstDataRendered = useCallback(() => {
    if (followOutput && followingRef.current && gridRef.current?.api) {
      gridRef.current.api.ensureIndexVisible(rowData.length - 1, "bottom");
    }
    selectExternalRow();
    if (gridRef.current?.api) onFirstDataRendered?.(gridRef.current.api);
  }, [
    followOutput,
    rowData.length,
    selectExternalRow,
    gridRef,
    onFirstDataRendered,
  ]);

  return (
    <div className={clsx(styles.gridWrapper, className)}>
      <div
        ref={gridContainerRef}
        className={clsx(
          styles.gridContainer,
          styles.gridChrome,
          viewMode === "list" ? styles.listMode : styles.gridMode
        )}
        tabIndex={0}
      >
        <AgGridReact<TRow>
          ref={gridRef}
          rowData={rowData}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          theme={themeBalham}
          animateRows={false}
          tooltipShowDelay={300}
          headerHeight={25}
          rowHeight={effectiveRowHeight}
          getRowId={getRowId as (p: GetRowIdParams<TRow>) => string}
          rowSelection={{ mode: "singleRow", checkboxes: false }}
          enableCellTextSelection={true}
          suppressCellFocus={true}
          domLayout="normal"
          initialState={initialState}
          onRowClicked={handleRowClick}
          onCellMouseDown={handleCellMouseDown}
          onColumnResized={handleColumnResized}
          onStateUpdated={handleStateUpdated}
          onFilterChanged={handleFilterChanged}
          onBodyScroll={handleBodyScroll}
          onGridReady={handleGridReady}
          onFirstDataRendered={handleFirstDataRendered}
          onGridColumnsChanged={handleGridColumnsChanged}
          onGridSizeChanged={handleGridSizeChanged}
          autoSizeStrategy={autoSizeStrategy}
          loading={loading}
        />
      </div>
    </div>
  );
};
