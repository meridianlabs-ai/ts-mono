import type {
  ColumnSizingState,
  RowData,
  SortingState,
} from "@tanstack/react-table";
import {
  KeyboardEvent,
  ReactElement,
  RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  combineFilters,
  type ColumnFilter,
  type FilterSpec,
  type FilterType,
} from "@tsmono/inspect-components/columnFilter";
import { FindBandUI, useFindBandShortcut } from "@tsmono/react/components";

import type { ValueComparator } from "../../log-list/listing/types";
import {
  sortingStateToOrderBy,
  useLogsListingQuery,
} from "../../log-list/listing/useLogsListingQuery";
import { ExtendedColumnDef } from "../data-grid/columnTypes";
import { DataGrid } from "../data-grid/DataGrid";
import { buildSearchIndex, findMatches } from "../data-grid/findMatches";

export const kListModeRowHeight = 70;
export const kGridModeRowHeight = 30;

interface SamplesGridProps<TRow extends RowData> {
  rowData: TRow[];
  columnDefs: ExtendedColumnDef<TRow>[];
  /** Controlled column visibility keyed by column id; missing entries
   *  default to visible. */
  columnVisibility?: Record<string, boolean>;
  /** `true` = list-style tall rows; otherwise compact. Affects row height. */
  multiline?: boolean;
  /** Initial sort applied until the user clicks a header. Uncontrolled mode
   *  only — ignored when `sorting` is provided. */
  defaultSorting?: SortingState;
  /**
   * Controlled sort. When provided, the grid renders this order and reports
   * header clicks via `onSortingChange` WITHOUT applying them itself — the
   * owner persists the sort and feeds it back (both consumers do, so sort
   * survives the grid unmounting on sample navigation). Same
   * choose-a-mode-for-the-lifetime convention as `columnFilters`.
   */
  sorting?: SortingState;
  onSortingChange?: (sorting: SortingState) => void;
  /** Controlled column widths (keyed by column id) — same contract as
   *  `sorting`. */
  columnSizing?: ColumnSizingState;
  onColumnSizingChange?: (sizing: ColumnSizingState) => void;
  getRowId: (row: TRow) => string;
  /** Row id that should be selected and scrolled into view. */
  selectedRowId?: string;
  /** Report selection moves instead of applying them — the caller owns
   *  selection and feeds it back through `selectedRowId` (see DataGrid's
   *  `onSelectedRowChange`). */
  onRowSelect?: (row: TRow) => void;
  /** Forwarded to the DataGrid's scroll container so the title bar can
   *  collapse on scroll. */
  scrollRef?: RefObject<HTMLDivElement | null>;
  onRowOpen: (row: TRow) => void;
  /** Row link target (see DataGrid's `getRowHref`). */
  getRowHref?: (row: TRow) => string | undefined;
  loading?: boolean;
  /**
   * Controlled column filters. When provided, the grid renders funnel state
   * from this map and reports edits via `onColumnFilterChange` WITHOUT
   * filtering rows itself — the owner filters upstream (the samples tab
   * derives these from the filtrex FILTER string). When absent, the grid
   * keeps its own local filter state and applies it client-side
   * (SamplesPanel's cross-log mode). Choose a mode for the component's
   * lifetime — flipping between providing and omitting this prop mid-session
   * would resurrect stale local state (standard React controlled-prop
   * convention).
   */
  columnFilters?: Record<string, ColumnFilter>;
  onColumnFilterChange?: (
    columnId: string,
    filterType: FilterType,
    spec: FilterSpec | null
  ) => void;
  /**
   * Apply `columnFilters` client-side even in controlled mode. Lets an owner
   * lift the filter state (e.g. to drive a "Reset Filters" button) while the
   * grid still does the filtering — the cross-log SamplesPanel has no upstream
   * filtrex pass. Ignored in uncontrolled mode (local filters always apply).
   */
  applyFiltersClientSide?: boolean;
  /** Hide all funnels (forwarded to DataGrid). */
  hideColumnFilters?: boolean;
  /**
   * Fires with the grid's rows after filtering and sorting are applied — the
   * exact set (and order) rendered. Lets an owner drive a filtered count or
   * cross-sample navigation off the grid's single source of truth rather than
   * re-deriving it from the unfiltered input.
   */
  onDisplayedRowsChange?: (rows: TRow[]) => void;
  /** Accessible name for the grid (see DataGrid's `ariaLabel`). */
  ariaLabel?: string;
  /** Focus the grid on mount (see DataGrid's `autoFocus`). */
  autoFocus?: boolean;
  /**
   * Ctrl/Cmd+F opens a find band over the grid, ahead of any page-level
   * find: it searches the displayed rows' column values (not just what the
   * cells show) and moves the selection through the matches through
   * `onRowSelect`, hiding no rows. Render the grid in a positioned box.
   */
  findable?: boolean;
}

/**
 * Shared samples grid: a `DataGrid` wrapper that runs client-side sort over
 * its rows via the same listing query the log list uses. Generic over the
 * row type, so other in-memory grids (a sample's communication) reuse it.
 * Per-column filtering is dual-mode: uncontrolled (no `columnFilters` prop —
 * local state, applied client-side; SamplesPanel's cross-log mode) or
 * controlled (the owner filters upstream — on the samples tab via the filtrex
 * FILTER string, which is also the persistence).
 */
export const SamplesGrid = <TRow extends RowData>({
  rowData,
  columnDefs,
  columnVisibility,
  multiline,
  defaultSorting,
  sorting: sortingProp,
  onSortingChange,
  columnSizing: columnSizingProp,
  onColumnSizingChange,
  getRowId,
  selectedRowId,
  onRowSelect,
  scrollRef,
  onRowOpen,
  getRowHref,
  loading,
  columnFilters,
  onColumnFilterChange,
  applyFiltersClientSide,
  hideColumnFilters,
  onDisplayedRowsChange,
  ariaLabel = "Samples",
  autoFocus = true,
  findable = false,
}: SamplesGridProps<TRow>): ReactElement => {
  const rowHeight = multiline ? kListModeRowHeight : kGridModeRowHeight;

  const [localSorting, setLocalSorting] = useState<SortingState>(
    defaultSorting ?? []
  );
  const [localFilters, setLocalFilters] = useState<
    Record<string, ColumnFilter>
  >({});
  const [localSizing, setLocalSizing] = useState<ColumnSizingState>({});

  const controlled = columnFilters !== undefined;
  const effectiveFilters = controlled ? columnFilters : localFilters;

  const sorting = sortingProp ?? localSorting;
  const handleSortingChange = useCallback(
    (next: SortingState) => {
      if (onSortingChange) onSortingChange(next);
      else setLocalSorting(next);
    },
    [onSortingChange]
  );

  const columnSizing = columnSizingProp ?? localSizing;
  const handleColumnSizingChange = useCallback(
    (next: ColumnSizingState) => {
      if (onColumnSizingChange) onColumnSizingChange(next);
      else setLocalSizing(next);
    },
    [onColumnSizingChange]
  );

  // Listing-query accessors derived from the column defs.
  const columnsById = useMemo(() => {
    const map = new Map<string, ExtendedColumnDef<TRow>>();
    for (const col of columnDefs) {
      if (col.id) map.set(col.id, col);
    }
    return map;
  }, [columnDefs]);

  const getValue = useCallback(
    (row: TRow, columnId: string): unknown => {
      const col = columnsById.get(columnId);
      if (col && "accessorFn" in col && typeof col.accessorFn === "function") {
        return col.accessorFn(row, 0);
      }
      return undefined;
    },
    [columnsById]
  );
  const getComparator = useCallback(
    (columnId: string): ValueComparator | undefined =>
      columnsById.get(columnId)?.meta?.sortComparator,
    [columnsById]
  );
  const getFilterType = useCallback(
    (columnId: string): FilterType | undefined =>
      columnsById.get(columnId)?.meta?.filterType,
    [columnsById]
  );

  // Controlled mode with upstream filtering: rows arrive already filtered
  // (filtrex) — only sort here. Uncontrolled, or controlled with
  // `applyFiltersClientSide`, filters here from `effectiveFilters`.
  const filterClientSide = !controlled || !!applyFiltersClientSide;
  const filter = useMemo(
    () => (filterClientSide ? combineFilters(effectiveFilters) : undefined),
    [filterClientSide, effectiveFilters]
  );
  const orderBy = useMemo(() => sortingStateToOrderBy(sorting), [sorting]);

  const { items } = useLogsListingQuery<TRow>({
    rows: rowData,
    filter,
    orderBy,
    getValue,
    getComparator,
    getFilterType,
  });

  // eslint-disable-next-line tsmono/no-raw-use-effect -- baselined at rule introduction; migrate to a named hook or derived state
  useEffect(() => {
    onDisplayedRowsChange?.(items);
  }, [items, onDisplayedRowsChange]);

  const handleColumnFilterChange = useCallback(
    (columnId: string, filterType: FilterType, spec: FilterSpec | null) => {
      if (onColumnFilterChange) {
        onColumnFilterChange(columnId, filterType, spec);
        return;
      }
      setLocalFilters((prev) => {
        const next = { ...prev };
        if (spec === null) delete next[columnId];
        else next[columnId] = { columnId, filterType, spec };
        return next;
      });
    },
    [onColumnFilterChange]
  );

  // Find, as the log list's grid does it, over this grid's displayed rows.
  const [findOpen, setFindOpen] = useState(false);
  const [findTerm, setFindTerm] = useState("");
  const findInputRef = useRef<HTMLInputElement>(null);
  const searchColumns = columnDefs.filter(
    (col) => col.id === undefined || columnVisibility?.[col.id] !== false
  );
  const matchesOf = (term: string) =>
    findMatches(buildSearchIndex(items, searchColumns, getRowId), term);
  const matchIds = findOpen ? matchesOf(findTerm) : [];
  const activeMatch =
    selectedRowId === undefined ? -1 : matchIds.indexOf(selectedRowId);

  const selectMatch = (ids: string[], index: number) => {
    const id = ids[index];
    const row = items.find((item) => getRowId(item) === id);
    if (row) onRowSelect?.(row);
  };
  const stepMatch = (back: boolean) => {
    const count = matchIds.length;
    if (count === 0) return;
    const next =
      activeMatch < 0 ? (back ? count - 1 : 0) : activeMatch + (back ? -1 : 1);
    selectMatch(matchIds, (next + count) % count);
  };
  const handleFindTermChange = () => {
    const term = findInputRef.current?.value ?? "";
    setFindTerm(term);
    selectMatch(matchesOf(term), 0);
  };
  const closeFind = () => {
    setFindOpen(false);
    setFindTerm("");
  };
  const openFind = () => {
    setFindOpen(true);
    setTimeout(() => {
      findInputRef.current?.focus();
      findInputRef.current?.select();
    });
  };
  const handleFindKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      closeFind();
    } else if (e.key === "Enter") {
      e.preventDefault();
      stepMatch(e.shiftKey);
    }
  };
  useFindBandShortcut(openFind, {
    onClose: closeFind,
    isOpen: findOpen,
    enabled: findable,
    preempt: true,
  });

  return (
    <>
      {findOpen ? (
        <FindBandUI
          inputRef={findInputRef}
          value={findTerm}
          onChange={handleFindTermChange}
          onKeyDown={handleFindKeyDown}
          onClose={closeFind}
          onPrevious={() => stepMatch(true)}
          onNext={() => stepMatch(false)}
          disableNav={matchIds.length === 0}
          noResults={!!findTerm && matchIds.length === 0}
          matchCount={findTerm ? matchIds.length : undefined}
          matchIndex={findTerm && activeMatch >= 0 ? activeMatch : undefined}
        />
      ) : null}
      <DataGrid<TRow>
        data={items}
        columns={columnDefs}
        getRowId={getRowId}
        columnVisibility={columnVisibility}
        sorting={sorting}
        onSortingChange={handleSortingChange}
        columnFilters={effectiveFilters}
        onColumnFilterChange={handleColumnFilterChange}
        hideColumnFilters={hideColumnFilters}
        columnSizing={columnSizing}
        onColumnSizingChange={handleColumnSizingChange}
        selectedRowId={selectedRowId}
        onSelectedRowChange={onRowSelect}
        scrollRef={scrollRef}
        onRowActivate={onRowOpen}
        getRowHref={getRowHref}
        rowHeight={rowHeight}
        multiline={multiline}
        loading={loading}
        autoFocus={autoFocus}
        ariaLabel={ariaLabel}
      />
    </>
  );
};
