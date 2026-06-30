import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  Header,
  OnChangeFn,
  SortingState,
  useReactTable,
  VisibilityState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import clsx from "clsx";
import {
  KeyboardEvent,
  MouseEvent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import type { SimpleCondition } from "@tsmono/inspect-common/query";
import {
  ColumnFilterControl,
  type ColumnFilter,
  type FilterType,
} from "@tsmono/inspect-components/columnFilter";

import { ExtendedColumnDef } from "./columnTypes";
import styles from "./DataGrid.module.css";
import { resolveKeyboardNavTarget } from "./keyboardNav";

const kRowHeight = 30;
const kPageJump = 10;
const kHeaderHeight = 25;
// Tall enough to host a rotated score-column label (≈92px of vertical
// extent for a 130px label at 45°) plus breathing room.
const kRotatedHeaderHeight = 115;
// Extra scroll width past the last column so its rotated label, which
// fans up-and-right beyond the column edge, isn't clipped at max scroll.
const kRotatedTrailingPad = 95;

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
  /** Controlled per-column filters (keyed by column id). */
  columnFilters?: Record<string, ColumnFilter>;
  onColumnFilterChange?: (
    columnId: string,
    filterType: FilterType,
    condition: SimpleCondition | null
  ) => void;
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
  columnFilters,
  onColumnFilterChange,
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

  // Rotated headers (compact score columns) need a taller header row, and
  // extra trailing scroll width so the last label isn't clipped.
  const anyRotated = table
    .getVisibleLeafColumns()
    .some((c) => (c.columnDef as ExtendedColumnDef<TRow>).meta?.rotateHeader);
  const effectiveHeaderHeight = anyRotated
    ? kRotatedHeaderHeight
    : headerHeight;
  const trailingPad = anyRotated ? kRotatedTrailingPad : 0;

  // The sticky header occupies layout space at the top of the scroll
  // container, so the virtualized rows start `headerHeight` px down. Two knobs
  // keep scrollToIndex in the same coordinate space as the DOM:
  //  - scrollMargin shifts the virtual offsets down by the header, so a row
  //    aligned to the bottom ("end"/"auto") isn't a header's-height too low
  //    (which clipped it at the bottom edge);
  //  - scrollPaddingStart reserves the header's height when aligning to the
  //    top ("start"/"auto"), so a row scrolled in from above sits below the
  //    sticky header instead of behind it.
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
    scrollMargin: effectiveHeaderHeight,
    scrollPaddingStart: effectiveHeaderHeight,
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
      // Pull focus to the grid so arrow-key navigation works after a click
      // (relevant when onRowActivate doesn't navigate away).
      containerRef.current?.focus();
      setSelectedId(rowId);
      onRowActivate(row);
    },
    [onRowActivate]
  );

  // Keyboard navigation (arrows / Home / End / PgUp-Dn move the selection;
  // Enter/Space activates), matching the prior AG-grid behavior. Bound to the
  // grid container (tabIndex=0); ignored while focus is in a form control so
  // typing in a filter popover doesn't move the selection.
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const active = document.activeElement;
      if (
        active &&
        (active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          active.tagName === "SELECT")
      ) {
        return;
      }

      const rowCount = rows.length;
      if (rowCount === 0) return;

      const currentIndex = selectedId
        ? rows.findIndex((r) => r.id === selectedId)
        : -1;

      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const row = currentIndex === -1 ? undefined : rows[currentIndex];
        if (row) onRowActivate(row.original);
        return;
      }

      const target = resolveKeyboardNavTarget({
        key: e.key,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        currentIndex,
        rowCount,
        pageJump: kPageJump,
      });
      if (target === null) return;
      e.preventDefault();
      if (target === currentIndex) return;

      const targetRow = rows[target];
      if (!targetRow) return;
      // The selection change drives the scroll-into-view effect below; doing
      // the scroll here too is redundant (react-virtual keeps only the last
      // pending scrollToIndex, so the effect's call wins anyway).
      setSelectedId(targetRow.id);
    },
    [rows, selectedId, onRowActivate]
  );

  const virtualItems = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  return (
    <div
      ref={containerRef}
      className={clsx(styles.container, className)}
      role="grid"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <div
        className={styles.table}
        style={{ width: totalWidth, paddingRight: trailingPad }}
      >
        <div
          className={styles.thead}
          style={{ height: effectiveHeaderHeight }}
          role="rowgroup"
        >
          {table.getHeaderGroups().map((headerGroup) => (
            <div key={headerGroup.id} className={styles.headerRow} role="row">
              {headerGroup.headers.map((header) => {
                const columnDef = header.column
                  .columnDef as ExtendedColumnDef<TRow>;
                const filterCondition =
                  columnFilters?.[header.column.id]?.condition ?? null;

                // Rotated (compact score) header: a 45° label hosting text +
                // sort caret + filter funnel. Rendered by a subcomponent so
                // the filter popover can anchor to a non-rotated element at
                // the cell's bottom — placing it below the header (like the
                // AG grid) rather than over the headers.
                if (columnDef.meta?.rotateHeader) {
                  return (
                    <RotatedHeaderCell
                      key={header.id}
                      header={header}
                      filterCondition={filterCondition}
                      onColumnFilterChange={onColumnFilterChange}
                    />
                  );
                }

                const align = columnDef.meta?.align;
                const filterType = columnDef.meta?.filterType;
                const sorted = header.column.getIsSorted();
                const sortCaret =
                  sorted === "asc" ? (
                    <i
                      className={clsx("bi bi-caret-up-fill", styles.sortIcon)}
                      aria-hidden="true"
                    />
                  ) : sorted === "desc" ? (
                    <i
                      className={clsx("bi bi-caret-down-fill", styles.sortIcon)}
                      aria-hidden="true"
                    />
                  ) : null;
                const headerLabel = header.isPlaceholder
                  ? null
                  : flexRender(
                      header.column.columnDef.header,
                      header.getContext()
                    );
                const filterControl =
                  columnDef.meta?.filterable && filterType ? (
                    <ColumnFilterControl
                      columnId={header.column.id}
                      filterType={filterType}
                      condition={filterCondition}
                      placement="bottom-start"
                      onChange={(condition) =>
                        onColumnFilterChange?.(
                          header.column.id,
                          filterType,
                          condition
                        )
                      }
                    />
                  ) : null;

                return (
                  <div
                    key={header.id}
                    className={clsx(
                      styles.headerCell,
                      anyRotated && styles.headerCellTall
                    )}
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
                      <span className={styles.headerText}>{headerLabel}</span>
                      {sortCaret}
                    </div>
                    {filterControl && (
                      <div
                        className={clsx(
                          styles.headerFilter,
                          filterCondition && styles.headerFilterActive
                        )}
                      >
                        {filterControl}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div
          className={styles.tbody}
          style={{
            height: Math.max(0, totalSize - effectiveHeaderHeight),
            width: totalWidth,
          }}
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
                  // scrollMargin shifts virtual offsets by the header height;
                  // the tbody already sits below the in-flow header, so
                  // subtract it.
                  transform: `translateY(${virtualRow.start - effectiveHeaderHeight}px)`,
                }}
                onClick={(e) => handleRowClick(e, row.id, row.original)}
                role="row"
                aria-selected={isSelected}
              >
                {row.getVisibleCells().map((cell) => {
                  const cellDef = cell.column
                    .columnDef as ExtendedColumnDef<TRow>;
                  const align = cellDef.meta?.align;
                  const cellStyle = cellDef.meta?.cellStyle?.(row.original);
                  return (
                    <div
                      key={cell.id}
                      className={clsx(
                        styles.cell,
                        align === "center" && styles.cellCenter
                      )}
                      style={{ width: cell.column.getSize(), ...cellStyle }}
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

/**
 * Rotated (compact score) header cell. The 45° label hosts the text, sort
 * caret, and filter funnel. The filter popover anchors to a hidden,
 * non-rotated element at the cell's bottom so it opens below the header
 * (under the column) instead of over the headers next to the funnel.
 */
function RotatedHeaderCell<TRow>({
  header,
  filterCondition,
  onColumnFilterChange,
}: {
  header: Header<TRow, unknown>;
  filterCondition: SimpleCondition | null;
  onColumnFilterChange?: (
    columnId: string,
    filterType: FilterType,
    condition: SimpleCondition | null
  ) => void;
}): ReactElement {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const columnDef = header.column.columnDef as ExtendedColumnDef<TRow>;
  const filterType = columnDef.meta?.filterType;
  const sorted = header.column.getIsSorted();
  const headerLabel = header.isPlaceholder
    ? null
    : flexRender(header.column.columnDef.header, header.getContext());

  return (
    <div
      className={clsx(styles.headerCell, styles.headerCellRotated)}
      style={{ width: header.getSize() }}
      title={columnDef.headerTitle}
      role="columnheader"
    >
      <div
        className={clsx(
          styles.rotatedLabel,
          filterCondition && styles.rotatedLabelFiltered
        )}
        onClick={header.column.getToggleSortingHandler()}
      >
        <span className={styles.rotatedText}>{headerLabel}</span>
        {sorted === "asc" && (
          <i
            className={clsx("bi bi-caret-up-fill", styles.sortIcon)}
            aria-hidden="true"
          />
        )}
        {sorted === "desc" && (
          <i
            className={clsx("bi bi-caret-down-fill", styles.sortIcon)}
            aria-hidden="true"
          />
        )}
        {columnDef.meta?.filterable && filterType && (
          <span className={styles.rotatedFilter}>
            <ColumnFilterControl
              columnId={header.column.id}
              filterType={filterType}
              condition={filterCondition}
              anchorEl={anchorEl}
              placement="bottom-start"
              onChange={(condition) =>
                onColumnFilterChange?.(header.column.id, filterType, condition)
              }
            />
          </span>
        )}
      </div>
      <span
        ref={setAnchorEl}
        className={styles.rotatedFilterAnchor}
        aria-hidden="true"
      />
    </div>
  );
}
