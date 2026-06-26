import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  OnChangeFn,
  SortingState,
  useReactTable,
  VisibilityState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import clsx from "clsx";
import {
  MouseEvent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { ExtendedColumnDef } from "./columnTypes";
import styles from "./DataGrid.module.css";

const kRowHeight = 30;
const kHeaderHeight = 25;

export interface DataGridProps<TRow> {
  data: TRow[];
  columns: ExtendedColumnDef<TRow>[];
  getRowId: (row: TRow) => string;
  /** Controlled column visibility (keyed by column id). Owned by the caller. */
  columnVisibility?: VisibilityState;
  /** Controlled sort state. Rows arrive already sorted (manualSorting); this
   *  drives only the header indicators. */
  sorting?: SortingState;
  onSortingChange?: (sorting: SortingState) => void;
  /** Row id to render as selected and keep scrolled into view. */
  selectedRowId?: string;
  /** Plain left-click on a row (modifier/middle clicks are left to in-cell
   *  links). */
  onRowActivate: (row: TRow) => void;
  rowHeight?: number;
  headerHeight?: number;
  loading?: boolean;
  emptyMessage?: string;
  className?: string;
}

/**
 * Inspect-local DataGrid: a minimal TanStack Table wrapper with row
 * virtualization, controlled column visibility, fixed column widths
 * (horizontal scroll), and single-row selection + click-to-activate.
 *
 * Sorting, filtering, keyboard navigation, find, and column resizing are
 * layered on in later phases — see design/plans/loglistgrid-tanstack.md.
 */
export function DataGrid<TRow>({
  data,
  columns,
  getRowId,
  columnVisibility,
  sorting,
  onSortingChange,
  selectedRowId,
  onRowActivate,
  rowHeight = kRowHeight,
  headerHeight = kHeaderHeight,
  loading = false,
  emptyMessage = "No matching items",
  className,
}: DataGridProps<TRow>): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);

  // Selection is driven by clicks but seeded/synced from the external
  // selectedRowId (e.g. the currently-open log) so the highlight survives
  // navigation back to the list.
  const [selectedId, setSelectedId] = useState<string | undefined>(
    selectedRowId
  );
  useEffect(() => {
    if (selectedRowId !== undefined) setSelectedId(selectedRowId);
  }, [selectedRowId]);

  // Sorting is done by the caller (rows arrive pre-sorted); the table only
  // tracks sort state to drive header indicators (manualSorting).
  const handleSortingChange: OnChangeFn<SortingState> = useCallback(
    (updater) => {
      if (!onSortingChange) return;
      onSortingChange(
        typeof updater === "function" ? updater(sorting ?? []) : updater
      );
    },
    [onSortingChange, sorting]
  );

  // useReactTable returns unmemoizable functions
  // https://github.com/TanStack/table/issues/5567
  // https://github.com/facebook/react/issues/33057
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns: columns as ColumnDef<TRow>[],
    getCoreRowModel: getCoreRowModel(),
    getRowId,
    manualSorting: true,
    enableMultiSort: true,
    enableSortingRemoval: true,
    state: {
      columnVisibility: columnVisibility ?? {},
      sorting: sorting ?? [],
    },
    onSortingChange: handleSortingChange,
  });

  const { rows } = table.getRowModel();
  const totalWidth = table.getTotalSize();

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
    getItemKey: (index) => rows[index]?.id ?? String(index),
  });

  // Keep the selected row visible when it changes from the outside.
  useEffect(() => {
    if (!selectedId) return;
    const index = rows.findIndex((r) => r.id === selectedId);
    if (index !== -1) rowVirtualizer.scrollToIndex(index, { align: "auto" });
  }, [selectedId, rows, rowVirtualizer]);

  const handleRowClick = useCallback(
    (e: MouseEvent<HTMLDivElement>, rowId: string, row: TRow) => {
      // Modifier / middle clicks are handled by the in-cell <a> overlay
      // (native open-in-new-tab); a plain left click selects + activates.
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      setSelectedId(rowId);
      onRowActivate(row);
    },
    [onRowActivate]
  );

  const virtualItems = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  return (
    <div
      ref={containerRef}
      className={clsx(styles.container, className)}
      role="grid"
    >
      <div className={styles.table} style={{ width: totalWidth }}>
        <div
          className={styles.thead}
          style={{ height: headerHeight }}
          role="rowgroup"
        >
          {table.getHeaderGroups().map((headerGroup) => (
            <div key={headerGroup.id} className={styles.headerRow} role="row">
              {headerGroup.headers.map((header) => {
                const columnDef = header.column
                  .columnDef as ExtendedColumnDef<TRow>;
                const align = columnDef.meta?.align;
                return (
                  <div
                    key={header.id}
                    className={styles.headerCell}
                    style={{ width: header.getSize() }}
                    title={columnDef.headerTitle}
                    role="columnheader"
                  >
                    <div
                      className={clsx(
                        styles.headerContent,
                        align === "center" && styles.headerCellCenter
                      )}
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      <span className={styles.headerText}>
                        {header.isPlaceholder
                          ? null
                          : flexRender(
                              header.column.columnDef.header,
                              header.getContext()
                            )}
                      </span>
                      {header.column.getIsSorted() === "asc" && (
                        <i
                          className={clsx(
                            "bi bi-caret-up-fill",
                            styles.sortIcon
                          )}
                          aria-hidden="true"
                        />
                      )}
                      {header.column.getIsSorted() === "desc" && (
                        <i
                          className={clsx(
                            "bi bi-caret-down-fill",
                            styles.sortIcon
                          )}
                          aria-hidden="true"
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div
          className={styles.tbody}
          style={{ height: totalSize, width: totalWidth }}
          role="rowgroup"
        >
          {virtualItems.map((virtualRow) => {
            const row = rows[virtualRow.index];
            if (!row) return null;
            const isSelected = row.id === selectedId;
            return (
              <div
                key={row.id}
                className={clsx(styles.row, isSelected && styles.rowSelected)}
                style={{
                  height: rowHeight,
                  width: totalWidth,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                onClick={(e) => handleRowClick(e, row.id, row.original)}
                role="row"
                aria-selected={isSelected}
              >
                {row.getVisibleCells().map((cell) => {
                  const cellDef = cell.column
                    .columnDef as ExtendedColumnDef<TRow>;
                  const align = cellDef.meta?.align;
                  return (
                    <div
                      key={cell.id}
                      className={clsx(
                        styles.cell,
                        align === "center" && styles.cellCenter
                      )}
                      style={{ width: cell.column.getSize() }}
                      title={cellDef.titleValue?.(row.original)}
                      role="gridcell"
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      {rows.length === 0 && (
        <div className={styles.empty}>
          {loading ? "Loading…" : emptyMessage}
        </div>
      )}
    </div>
  );
}
