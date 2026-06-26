import type { SortingState } from "@tanstack/react-table";
import { ReactElement, useCallback, useMemo, useState } from "react";

import type { SimpleCondition } from "@tsmono/inspect-common/query";
import type {
  ColumnFilter,
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

export type SamplesGridViewMode = "list" | "grid";

const kListModeRowHeight = 70;
const kGridModeRowHeight = 30;

interface SamplesGridProps<TRow> {
  rowData: TRow[];
  columnDefs: ExtendedColumnDef<TRow>[];
  /** Controlled column visibility keyed by column id; missing entries
   *  default to visible. */
  columnVisibility?: Record<string, boolean>;
  viewMode: SamplesGridViewMode;
  /** `true` = list-style tall rows; `false` = compact rows. Falls back to
   *  `viewMode === "list"` when unset. Affects row height only. */
  multiline?: boolean;
  /** Initial sort applied until the user clicks a header (e.g. the cross-log
   *  panel seeds Completed-desc). */
  defaultSorting?: SortingState;
  getRowId: (row: TRow) => string;
  /** Row id that should be selected and scrolled into view. */
  selectedRowId?: string;
  onRowOpen: (
    row: TRow,
    opts: { newWindow: boolean; via: "click" | "key" }
  ) => void;
  loading?: boolean;
  className?: string;
}

/**
 * Shared samples grid: a `DataGrid` wrapper that runs client-side sort +
 * per-column filtering over `rowData` via the listing query (the same engine
 * the log list uses). Sort/filter state is local to the grid; persistence is
 * not wired yet.
 */
export const SamplesGrid = <TRow,>({
  rowData,
  columnDefs,
  columnVisibility,
  viewMode,
  multiline,
  defaultSorting,
  getRowId,
  selectedRowId,
  onRowOpen,
  loading,
  className,
}: SamplesGridProps<TRow>): ReactElement => {
  const isTall = multiline ?? viewMode === "list";
  const rowHeight = isTall ? kListModeRowHeight : kGridModeRowHeight;

  const [sorting, setSorting] = useState<SortingState>(defaultSorting ?? []);
  const [columnFilters, setColumnFilters] = useState<
    Record<string, ColumnFilter>
  >({});

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

  const filter = useMemo(() => combineFilters(columnFilters), [columnFilters]);
  const orderBy = useMemo(() => sortingStateToOrderBy(sorting), [sorting]);

  const { items } = useLogsListingQuery<TRow>({
    rows: rowData,
    filter,
    orderBy,
    getValue,
    getComparator,
    getFilterType,
  });

  const handleColumnFilterChange = useCallback(
    (
      columnId: string,
      filterType: FilterType,
      condition: SimpleCondition | null
    ) => {
      setColumnFilters((prev) => {
        const next = { ...prev };
        if (condition === null) delete next[columnId];
        else next[columnId] = { columnId, filterType, condition };
        return next;
      });
    },
    []
  );

  return (
    <DataGrid<TRow>
      data={items}
      columns={columnDefs}
      getRowId={getRowId}
      columnVisibility={columnVisibility}
      sorting={sorting}
      onSortingChange={setSorting}
      columnFilters={columnFilters}
      onColumnFilterChange={handleColumnFilterChange}
      selectedRowId={selectedRowId}
      onRowActivate={(row) =>
        onRowOpen(row, { newWindow: false, via: "click" })
      }
      rowHeight={rowHeight}
      loading={loading}
      className={className}
    />
  );
};
