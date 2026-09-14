import {
  constructSortFn,
  createSortedRowModel,
  flexRender,
  functionalUpdate,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { ColumnTable } from "arquero";
import clsx from "clsx";
import { FC, useRef, useState } from "react";

import { ColumnFilterControl } from "@tsmono/inspect-components/columnFilter";
import {
  useEventListener,
  useLatestRef,
  useMountEffect,
  useValueChange,
} from "@tsmono/react/hooks";
import { VirtualList, type VirtualListHandle } from "@tsmono/react/virtual";

import {
  emptyDataframeState,
  GRID_STATE_NAME,
  type DataframeState,
} from "../../state/dataframeState";
import { useStore } from "../../state/store";
import { useSetDataframeGridApi } from "../scan/scanners/dataframe/DataframeGridApiContext";
import { rowRecords } from "../utils/arrowCells";
import { valueAsString } from "../utils/format";

import { fitContentStrategy } from "./columnSizing/fitContentStrategy";
import { getColumnConstraints } from "./columnSizing/types";
import type { ExtendedColumnDef } from "./columnTypes";
import {
  compareDataframeValues,
  dataframeCsv,
  dataframeFilterType,
  dataframeOperators,
  dataframePinOffsets,
  downloadDataframeCsv,
  formatDataframeValue,
  matchesDataframeFilter,
  type DataframeRow,
} from "./dataframeModel";
import styles from "./DataframeView.module.css";
import { dataGridFeatures } from "./dataGrid/tableFeatures";

const features = tableFeatures({
  ...dataGridFeatures,
  sortedRowModel: createSortedRowModel(),
});
const sortFn = constructSortFn({ sort: compareDataframeValues });
const rowHeight = 29;

interface DataframeViewProps {
  columnTable?: ColumnTable;
  sortedColumns?: string[];
  onRowDoubleClicked?: (rowData: DataframeRow) => void;
  onVisibleRowCountChanged?: (count: number) => void;
  options?: { maxStrLen?: number };
  enableKeyboardNavigation?: boolean;
  showRowNumbers?: boolean;
  wrapText?: boolean;
}

export const DataframeView: FC<DataframeViewProps> = ({
  columnTable,
  sortedColumns,
  onRowDoubleClicked,
  onVisibleRowCountChanged,
  options,
  enableKeyboardNavigation = true,
  showRowNumbers = false,
  wrapText = false,
}) => {
  const state =
    useStore((store) => store.gridStates[GRID_STATE_NAME]) ??
    emptyDataframeState;
  const setGridState = useStore((store) => store.setGridState);
  const updateGridState = (patch: Partial<DataframeState>): void => {
    setGridState(GRID_STATE_NAME, (previous) => ({ ...previous, ...patch }));
  };
  const selectedRow = useStore((store) => store.selectedResultRow);
  const setSelectedRow = useStore((store) => store.setSelectedResultRow);
  const setGridApi = useSetDataframeGridApi();
  const containerRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const listRef = useRef<VirtualListHandle>(null);
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);

  const allRows = columnTable ? rowRecords(columnTable) : [];
  const available = columnTable?.columnNames() ?? [];
  const columnNames = (sortedColumns ?? available).filter((name) =>
    available.includes(name)
  );
  const activeFilters = Object.entries(state.columnFilters).filter(([id]) =>
    columnNames.includes(id)
  );
  const leftPinned = state.columnPinning.left.filter((id) =>
    columnNames.includes(id)
  );
  const rightPinned = state.columnPinning.right.filter(
    (id) => columnNames.includes(id) && !leftPinned.includes(id)
  );
  const columnOrder = [
    ...new Set([...state.columnOrder, ...columnNames]),
  ].filter(
    (id) =>
      columnNames.includes(id) &&
      !leftPinned.includes(id) &&
      !rightPinned.includes(id)
  );
  const data = activeFilters.length
    ? allRows.filter((row) =>
        activeFilters.every(([id, filter]) =>
          matchesDataframeFilter(row[id], filter)
        )
      )
    : allRows;
  const columns: ExtendedColumnDef<DataframeRow>[] = columnNames.map(
    (name) => ({
      id: name,
      accessorKey: name,
      // Literal column names can contain dots; TanStack's accessorKey treats them
      // as nested paths, whereas a dataframe is a flat record.
      accessorFn: (row) => row[name],
      header: name,
      sortFn,
      sortUndefined: false,
      sortDescFirst: false,
      minSize: 40,
      maxSize: 800,
      cell: (cell) => formatDataframeValue(cell.getValue(), options),
      textValue: (value) => formatDataframeValue(value, options),
    })
  );
  const table = useTable({
    features,
    data,
    columns,
    enableMultiSort: true,
    columnResizeMode: "onChange",
    state: {
      sorting: state.sorting.filter((sort) => columnNames.includes(sort.id)),
      columnSizing: state.columnSizing,
      columnOrder: [...leftPinned, ...columnOrder, ...rightPinned],
    },
    onSortingChange: (updater) =>
      updateGridState({
        sorting: functionalUpdate(updater, state.sorting),
      }),
    onColumnSizingChange: (updater) =>
      updateGridState({
        columnSizing: functionalUpdate(updater, state.columnSizing),
      }),
  });
  const rows = table.getRowModel().rows;
  const selectedIndex = Math.max(
    0,
    Math.min(selectedRow ?? 0, rows.length - 1)
  );

  const autoSize = (columnId?: string): void => {
    const sizes = fitContentStrategy.computeSizes({
      tableElement: tableRef.current,
      columns,
      data: allRows,
      constraints: getColumnConstraints(columns),
    });
    // The first header is the pinned row counter. Reserve room explicitly
    // for the data headers' sort arrow and filter button when auto-sizing.
    for (const name of columnNames) {
      sizes[name] = Math.min(
        800,
        Math.max((sizes[name] ?? 150) + 2, name.length * 7 + 50)
      );
    }
    updateGridState({
      columnSizing: columnId
        ? { ...state.columnSizing, [columnId]: sizes[columnId] ?? 150 }
        : { ...sizes, ...state.columnSizing },
    });
  };
  useValueChange(columnTable, () => autoSize());
  useValueChange(JSON.stringify(columnNames), () => autoSize());
  useValueChange(rows.length, (count) => onVisibleRowCountChanged?.(count));
  useValueChange(selectedRow, () => {
    if (selectedRow !== undefined && rows.length)
      listRef.current?.scrollToIndex({ index: selectedIndex });
  });

  const exportRef = useLatestRef({ rows, columnNames, options });
  useMountEffect(() => {
    const getDataAsCsv = ({ columnKeys }: { columnKeys: string[] }) => {
      const current = exportRef.current;
      return dataframeCsv(
        current.rows.map((row) => row.original),
        columnKeys.filter((id) => current.columnNames.includes(id)),
        current.options
      );
    };
    setGridApi({
      getDataAsCsv,
      exportDataAsCsv: ({ fileName, columnKeys }) =>
        downloadDataframeCsv(getDataAsCsv({ columnKeys }), fileName),
    });
    if (containerRef.current) {
      containerRef.current.scrollLeft = state.scroll.left;
      containerRef.current.scrollTop = state.scroll.top;
    }
    return () => setGridApi(null);
  });

  const activate = (index: number): void => {
    const row = rows[index];
    if (!row) return;
    setSelectedRow(index);
    onRowDoubleClicked?.(row.original);
  };

  useEventListener(
    enableKeyboardNavigation ? document : null,
    "keydown",
    (event) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest(
          "input, textarea, select, button, [contenteditable=true], [role=dialog], [role=slider]"
        )
      )
        return;
      if (!rows.length) return;
      if (event.key === "Enter") {
        event.preventDefault();
        activate(selectedIndex);
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      const last = rows.length - 1;
      const next =
        event.ctrlKey || event.metaKey
          ? event.key === "ArrowDown"
            ? last
            : 0
          : Math.max(
              0,
              Math.min(
                last,
                selectedIndex + (event.key === "ArrowDown" ? 1 : -1)
              )
            );
      setSelectedRow(next);
      listRef.current?.scrollToIndex({ index: next });
    }
  );

  const orderedColumns = table.getVisibleLeafColumns();
  const pinnedOffsets = dataframePinOffsets(
    orderedColumns.map((column) => ({ id: column.id, size: column.getSize() })),
    { left: leftPinned, right: rightPinned },
    showRowNumbers ? 60 : 0
  );
  const width = table.getTotalSize() + (showRowNumbers ? 60 : 0);

  return (
    <div
      ref={containerRef}
      className={styles.gridWrapper}
      role="grid"
      aria-label="Scanner results"
      aria-rowcount={rows.length + 1}
      aria-colcount={columnNames.length + (showRowNumbers ? 1 : 0)}
      tabIndex={0}
      onDragOver={(event) => {
        if (draggedColumn) event.preventDefault();
      }}
      onDropCapture={(event) => {
        if (!draggedColumn) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        const side =
          event.clientX < bounds.left + 60
            ? "left"
            : event.clientX > bounds.right - 24
              ? "right"
              : null;
        if (!side) return;
        event.preventDefault();
        event.stopPropagation();
        const pinning = {
          left: leftPinned.filter((id) => id !== draggedColumn),
          right: rightPinned.filter((id) => id !== draggedColumn),
        };
        pinning[side].push(draggedColumn);
        updateGridState({ columnPinning: pinning });
        setDraggedColumn(null);
        setDragOverColumn(null);
      }}
      onScroll={(event) => {
        const { scrollTop: top, scrollLeft: left } = event.currentTarget;
        if (top !== state.scroll.top || left !== state.scroll.left)
          updateGridState({ scroll: { top, left } });
      }}
    >
      <div style={{ width, minWidth: "100%" }}>
        <table
          ref={tableRef}
          role="presentation"
          className={styles.table}
          style={{ width, minWidth: "100%" }}
        >
          <thead className={styles.header}>
            <tr role="row" className={styles.headerRow}>
              {showRowNumbers && (
                <th
                  role="columnheader"
                  className={styles.rowNumber}
                  style={{ width: 60 }}
                />
              )}
              {table.getHeaderGroups()[0]?.headers.map((header) => {
                const id = header.column.id;
                const sorted = header.column.getIsSorted();
                const type =
                  state.columnFilters[id]?.filterType ??
                  dataframeFilterType(allRows, id);
                return (
                  <th
                    key={id}
                    role="columnheader"
                    aria-label={id}
                    aria-sort={
                      sorted === "asc"
                        ? "ascending"
                        : sorted === "desc"
                          ? "descending"
                          : "none"
                    }
                    className={clsx(
                      styles.headerCell,
                      pinnedOffsets[id] && styles.pinned,
                      dragOverColumn === id && styles.dragOver
                    )}
                    style={{ width: header.getSize(), ...pinnedOffsets[id] }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setDragOverColumn(id);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (draggedColumn && draggedColumn !== id) {
                        const order = orderedColumns.map((column) => column.id);
                        const from = order.indexOf(draggedColumn);
                        const to = order.indexOf(id);
                        order.splice(from, 1);
                        order.splice(to, 0, draggedColumn);
                        updateGridState({
                          columnOrder: order,
                          columnPinning: {
                            left: order.filter((column) =>
                              column === draggedColumn
                                ? leftPinned.includes(id)
                                : leftPinned.includes(column)
                            ),
                            right: order.filter((column) =>
                              column === draggedColumn
                                ? rightPinned.includes(id)
                                : rightPinned.includes(column)
                            ),
                          },
                        });
                      }
                      setDraggedColumn(null);
                      setDragOverColumn(null);
                    }}
                  >
                    <button
                      type="button"
                      className={styles.headerLabel}
                      title={id}
                      draggable
                      onClick={(event) => {
                        event.stopPropagation();
                        header.column.getToggleSortingHandler()?.(event);
                        if (event.detail > 0) containerRef.current?.focus();
                      }}
                      onDragStart={(event) => {
                        event.dataTransfer.setData("text/plain", id);
                        setDraggedColumn(id);
                      }}
                      onDragEnd={() => {
                        setDraggedColumn(null);
                        setDragOverColumn(null);
                      }}
                    >
                      <span>{id}</span>
                      {sorted && (
                        <i
                          aria-hidden="true"
                          className={
                            sorted === "asc"
                              ? "bi bi-arrow-up"
                              : "bi bi-arrow-down"
                          }
                        />
                      )}
                    </button>
                    <ColumnFilterControl
                      columnId={id}
                      filterType={type}
                      operators={dataframeOperators(type)}
                      spec={state.columnFilters[id]?.spec ?? null}
                      onChange={(spec) => {
                        const filters = { ...state.columnFilters };
                        if (spec)
                          filters[id] = {
                            columnId: id,
                            filterType: type,
                            spec,
                          };
                        else delete filters[id];
                        updateGridState({
                          columnFilters: filters,
                        });
                      }}
                    />
                    <div
                      role="slider"
                      tabIndex={0}
                      aria-valuenow={header.getSize()}
                      aria-valuemin={40}
                      aria-valuemax={800}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          autoSize(id);
                        }
                        if (
                          event.key === "ArrowLeft" ||
                          event.key === "ArrowRight"
                        ) {
                          event.preventDefault();
                          event.stopPropagation();
                          updateGridState({
                            columnSizing: {
                              ...state.columnSizing,
                              [id]: Math.max(
                                40,
                                Math.min(
                                  800,
                                  header.getSize() +
                                    (event.key === "ArrowRight" ? 10 : -10)
                                )
                              ),
                            },
                          });
                        }
                      }}
                      aria-label={`Resize ${id}`}
                      aria-orientation="vertical"
                      className={styles.resizer}
                      onClick={(event) => event.stopPropagation()}
                      onMouseDown={header.getResizeHandler()}
                      onTouchStart={header.getResizeHandler()}
                      onDoubleClick={(event) => {
                        event.stopPropagation();
                        autoSize(id);
                      }}
                    />
                  </th>
                );
              })}
            </tr>
          </thead>
        </table>
        <VirtualList
          ref={listRef}
          persistenceKey="scanner-dataframe"
          data={rows}
          scrollRef={containerRef}
          embedded
          smoothScroll={false}
          resetScrollOnMount={false}
          estimatedItemHeight={rowHeight}
          overscan={10}
          useFlushSync={false}
          scrollPaddingStart={32}
          findScope="none"
          renderRow={(index, row) => (
            <div
              role="row"
              tabIndex={-1}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.stopPropagation();
                  activate(index);
                }
              }}
              aria-rowindex={index + 2}
              aria-selected={
                selectedRow !== undefined && index === selectedIndex
              }
              className={clsx(
                styles.row,
                index % 2 === 1 && styles.alternate,
                wrapText && styles.wrapped,
                selectedRow !== undefined &&
                  index === selectedIndex &&
                  styles.selected
              )}
              style={{
                minHeight: rowHeight,
              }}
              onClick={() => setSelectedRow(index)}
              onDoubleClick={() => activate(index)}
            >
              {showRowNumbers && (
                <div
                  role="gridcell"
                  className={styles.rowNumber}
                  style={{ width: 60 }}
                >
                  <button
                    type="button"
                    className={styles.rowNumberButton}
                    onClick={() => activate(index)}
                  >
                    {index + 1}
                  </button>
                </div>
              )}
              {row.getVisibleCells().map((cell) => (
                <div
                  key={cell.id}
                  role="gridcell"
                  className={clsx(
                    styles.cell,
                    pinnedOffsets[cell.column.id] && styles.pinned
                  )}
                  style={{
                    width: cell.column.getSize(),
                    ...pinnedOffsets[cell.column.id],
                  }}
                  title={
                    cell.getValue() == null
                      ? undefined
                      : valueAsString(cell.getValue())
                  }
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </div>
              ))}
            </div>
          )}
        />
      </div>
      {rows.length === 0 && <div className={styles.empty}>No Rows To Show</div>}
    </div>
  );
};
