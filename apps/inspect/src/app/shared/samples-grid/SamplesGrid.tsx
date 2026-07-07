import type { ColumnSizingState, SortingState } from "@tanstack/react-table";
import { ReactElement, RefObject, useCallback, useMemo, useState } from "react";

import type {
  ColumnFilter,
  FilterSpec,
  FilterType,
} from "@tsmono/inspect-components/columnFilter";

import { combineFilters } from "../../log-list/listing/combineFilters";
import type { ValueComparator } from "../../log-list/listing/types";
import {
  sortingStateToOrderBy,
  useLogsListingQuery,
} from "../../log-list/listing/useLogsListingQuery";
import { ExtendedColumnDef } from "../data-grid/columnTypes";
import { DataGrid } from "../data-grid/DataGrid";

import { SampleRow } from "./types";

const kListModeRowHeight = 70;
const kGridModeRowHeight = 30;

interface SamplesGridProps {
  rowData: SampleRow[];
  columnDefs: ExtendedColumnDef<SampleRow>[];
  /** Controlled column visibility keyed by column id; missing entries
   *  default to visible. */
  columnVisibility?: Record<string, boolean>;
  /** `true` = list-style tall rows; otherwise compact. Affects row height. */
  multiline?: boolean;
  /** Initial sort applied until the user clicks a header (e.g. the cross-log
   *  panel seeds Completed-desc). */
  defaultSorting?: SortingState;
  getRowId: (row: SampleRow) => string;
  /** Row id that should be selected and scrolled into view. */
  selectedRowId?: string;
  /** Report selection moves instead of applying them — the caller owns
   *  selection and feeds it back through `selectedRowId` (see DataGrid's
   *  `onSelectedRowChange`). */
  onRowSelect?: (row: SampleRow) => void;
  /** Forwarded to the DataGrid's scroll container so the title bar can
   *  collapse on scroll. */
  scrollRef?: RefObject<HTMLDivElement | null>;
  onRowOpen: (row: SampleRow) => void;
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
  /** Hide all funnels (forwarded to DataGrid). */
  hideColumnFilters?: boolean;
}

/**
 * Shared samples grid: a `DataGrid` wrapper that runs client-side sort over
 * its rows via the same listing query the log list uses. Per-column filtering
 * is dual-mode: uncontrolled (no `columnFilters` prop — local state, applied
 * client-side; SamplesPanel's cross-log mode) or controlled (the owner
 * filters upstream — on the samples tab via the filtrex FILTER string, which
 * is also the persistence).
 */
export const SamplesGrid = ({
  rowData,
  columnDefs,
  columnVisibility,
  multiline,
  defaultSorting,
  getRowId,
  selectedRowId,
  onRowSelect,
  scrollRef,
  onRowOpen,
  loading,
  columnFilters,
  onColumnFilterChange,
  hideColumnFilters,
}: SamplesGridProps): ReactElement => {
  const rowHeight = multiline ? kListModeRowHeight : kGridModeRowHeight;

  const [sorting, setSorting] = useState<SortingState>(defaultSorting ?? []);
  const [localFilters, setLocalFilters] = useState<
    Record<string, ColumnFilter>
  >({});
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});

  const controlled = columnFilters !== undefined;
  const effectiveFilters = controlled ? columnFilters : localFilters;

  // Listing-query accessors derived from the column defs.
  const columnsById = useMemo(() => {
    const map = new Map<string, ExtendedColumnDef<SampleRow>>();
    for (const col of columnDefs) {
      if (col.id) map.set(col.id, col);
    }
    return map;
  }, [columnDefs]);

  const getValue = useCallback(
    (row: SampleRow, columnId: string): unknown => {
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

  // Controlled mode: rows arrive already filtered (filtrex upstream) — only
  // sort here. Uncontrolled: filter + sort client-side as before.
  const filter = useMemo(
    () => (controlled ? undefined : combineFilters(localFilters)),
    [controlled, localFilters]
  );
  const orderBy = useMemo(() => sortingStateToOrderBy(sorting), [sorting]);

  const { items } = useLogsListingQuery<SampleRow>({
    rows: rowData,
    filter,
    orderBy,
    getValue,
    getComparator,
    getFilterType,
  });

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

  return (
    <DataGrid<SampleRow>
      data={items}
      columns={columnDefs}
      getRowId={getRowId}
      columnVisibility={columnVisibility}
      sorting={sorting}
      onSortingChange={setSorting}
      columnFilters={effectiveFilters}
      onColumnFilterChange={handleColumnFilterChange}
      hideColumnFilters={hideColumnFilters}
      columnSizing={columnSizing}
      onColumnSizingChange={setColumnSizing}
      selectedRowId={selectedRowId}
      onSelectedRowChange={onRowSelect}
      scrollRef={scrollRef}
      onRowActivate={onRowOpen}
      rowHeight={rowHeight}
      multiline={multiline}
      loading={loading}
      autoFocus
    />
  );
};
