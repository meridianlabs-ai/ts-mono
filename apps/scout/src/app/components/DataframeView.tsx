import {
  columnPinningFeature,
  constructSortFn,
  createSortedRowModel,
  flexRender,
  functionalUpdate,
  tableFeatures,
  useTable,
  type ColumnDef,
} from "@tanstack/react-table";
import clsx from "clsx";
import { FC, useRef, useState } from "react";

import { ColumnFilterControl } from "@tsmono/inspect-components/columnFilter";
import {
  useEventListener,
  useLatestRef,
  useMountEffect,
} from "@tsmono/react/hooks";
import { VirtualList, type VirtualListHandle } from "@tsmono/react/virtual";
import { valueAsString } from "@tsmono/util";

import {
  emptyDataframeState,
  GRID_STATE_NAME,
  type DataframeState,
} from "../../state/dataframeState";
import { useStore } from "../../state/store";
import { useSetDataframeGridApi } from "../scan/scanners/dataframe/DataframeGridApiContext";

import { fitContentStrategy } from "./columnSizing/fitContentStrategy";
import {
  getColumnConstraints,
  type ColumnSizingDefinition,
} from "./columnSizing/types";
import {
  compareDataframeValues,
  dataframeCsv,
  dataframeFilterType,
  dataframeOperators,
  downloadDataframeCsv,
  formatDataframeValue,
  type DataframeRow,
} from "./dataframeModel";
import styles from "./DataframeView.module.css";
import { ColumnResizeHandle } from "./dataGrid/ColumnResizeHandle";
import { dataGridFeatures } from "./dataGrid/tableFeatures";
import type { DataframeData } from "./useDataframeData";

const features = tableFeatures({
  ...dataGridFeatures,
  columnPinningFeature,
  sortedRowModel: createSortedRowModel(),
});
const sortFn = constructSortFn({ sort: compareDataframeValues });
const rowHeight = 29;

interface DataframeViewProps {
  dataframe: DataframeData;
  onRowDoubleClicked: (rowData: DataframeRow) => void;
  wrapText?: boolean;
}

export const DataframeView: FC<DataframeViewProps> = ({
  dataframe: { allRows, rows: data, columnNames },
  onRowDoubleClicked,
  wrapText = false,
}) => {
  const state =
    useStore((store) => store.gridStates[GRID_STATE_NAME]) ??
    emptyDataframeState;
  // Restoring one axis emits scroll events before the other has settled.
  const [initialScroll] = useState(state.scroll);
  const setGridState = useStore((store) => store.setGridState);
  const updateGridState = (
    update: (previous: DataframeState) => Partial<DataframeState>
  ): void => {
    setGridState(GRID_STATE_NAME, (previous) => ({
      ...previous,
      ...update(previous),
    }));
  };
  const selectedRow = useStore((store) => store.selectedResultRow);
  const setSelectedRow = useStore((store) => store.setSelectedResultRow);
  const setGridApi = useSetDataframeGridApi();
  const containerRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const listRef = useRef<VirtualListHandle>(null);
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);

  const columns: (ColumnDef<typeof features, DataframeRow> &
    ColumnSizingDefinition)[] = columnNames.map((name) => ({
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
    cell: (cell) => formatDataframeValue(cell.getValue()),
    textValue: formatDataframeValue,
  }));
  const table = useTable<typeof features, DataframeRow>({
    features,
    data,
    columns,
    enableMultiSort: true,
    columnResizeMode: "onChange",
    state: {
      sorting: state.sorting.filter((sort) => columnNames.includes(sort.id)),
      columnSizing: state.columnSizing,
      columnOrder: state.columnOrder,
      columnPinning: state.columnPinning,
    },
    onSortingChange: (updater) =>
      updateGridState((previous) => ({
        sorting: functionalUpdate(updater, previous.sorting),
      })),
    onColumnPinningChange: (updater) =>
      updateGridState((previous) => ({
        columnPinning: functionalUpdate(updater, previous.columnPinning),
      })),
    onColumnSizingChange: (updater) =>
      updateGridState((previous) => ({
        columnSizing: functionalUpdate(updater, previous.columnSizing),
      })),
  });
  const rows = table.getRowModel().rows;
  const selectedIndex = Math.max(
    0,
    Math.min(selectedRow ?? 0, rows.length - 1)
  );

  const autoSize = (columnId?: string, element = tableRef.current): void => {
    const sizes = fitContentStrategy.computeSizes({
      tableElement: element,
      columns,
      data: allRows,
      constraints: getColumnConstraints(columns),
    });
    updateGridState((previous) => ({
      columnSizing: columnId
        ? { ...previous.columnSizing, [columnId]: sizes[columnId] ?? 150 }
        : { ...sizes, ...previous.columnSizing },
    }));
  };
  const exportRef = useLatestRef({ rows, columnNames });
  useMountEffect(() => {
    const getDataAsCsv = ({ columnKeys }: { columnKeys: string[] }) => {
      const current = exportRef.current;
      return dataframeCsv(
        current.rows.map((row) => row.original),
        columnKeys.filter((id) => current.columnNames.includes(id))
      );
    };
    setGridApi({
      getDataAsCsv,
      exportDataAsCsv: ({ fileName, columnKeys }) =>
        downloadDataframeCsv(getDataAsCsv({ columnKeys }), fileName),
    });
    // Column measurement commits before restoring horizontal scroll; otherwise
    // an initially narrow table clamps the saved offset to zero.
    const frame = requestAnimationFrame(() => {
      containerRef.current?.scrollTo({
        left: initialScroll.left,
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      setGridApi(null);
    };
  });

  const activate = (index: number): void => {
    const row = rows[index];
    if (!row) return;
    setSelectedRow(index);
    onRowDoubleClicked(row.original);
  };

  useEventListener(document, "keydown", (event) => {
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      target.closest(
        "input, textarea, select, [contenteditable=true], [role=dialog], [role=slider]"
      )
    )
      return;
    if (!rows.length) return;
    if (event.key === "Enter") {
      if (target instanceof HTMLElement && target.closest("button")) return;
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
            Math.min(last, selectedIndex + (event.key === "ArrowDown" ? 1 : -1))
          );
    setSelectedRow(next);
    listRef.current?.scrollToIndex({ index: next });
  });

  const headers = table.getHeaderGroups()[0]?.headers ?? [];
  const width = table.getTotalSize() + 60;

  return (
    <div
      ref={containerRef}
      className={styles.gridWrapper}
      role="grid"
      aria-label="Scanner results"
      aria-rowcount={rows.length + 1}
      aria-colcount={columnNames.length + 1}
      tabIndex={0}
      onDragOver={(event) => {
        if (draggedColumn) event.preventDefault();
      }}
      onDropCapture={(event) => {
        if (!draggedColumn) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        const side =
          event.clientX < bounds.left + 60
            ? "start"
            : event.clientX > bounds.right - 24
              ? "end"
              : null;
        if (!side) return;
        event.preventDefault();
        event.stopPropagation();
        table.getColumn(draggedColumn)?.pin(side);
        setDraggedColumn(null);
        setDragOverColumn(null);
      }}
      onScroll={(event) => {
        const { scrollTop: top, scrollLeft: left } = event.currentTarget;
        updateGridState(() => ({ scroll: { top, left } }));
      }}
    >
      <div style={{ width, minWidth: "100%" }}>
        <table
          ref={(element) => {
            tableRef.current = element;
            if (
              element &&
              columnNames.some((id) => state.columnSizing[id] === undefined)
            )
              autoSize(undefined, element);
          }}
          role="presentation"
          className={styles.table}
          style={{ width, minWidth: "100%" }}
        >
          <thead className={styles.header}>
            <tr role="row" className={styles.headerRow}>
              <th
                role="columnheader"
                className={styles.rowNumber}
                style={{ width: 60 }}
              />
              {headers.map((header) => {
                const id = header.column.id;
                const sorted = header.column.getIsSorted();
                const pinned = header.column.getIsPinned();
                const type =
                  state.columnFilters[id]?.filterType ??
                  dataframeFilterType(allRows, id);
                return (
                  <th
                    key={id}
                    role="columnheader"
                    data-column-id={id}
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
                      pinned && styles.pinned,
                      dragOverColumn === id && styles.dragOver
                    )}
                    style={{
                      width: header.getSize(),
                      left:
                        pinned === "start"
                          ? header.column.getStart("start") + 60
                          : undefined,
                      right:
                        pinned === "end"
                          ? header.column.getAfter("end")
                          : undefined,
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setDragOverColumn(id);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (draggedColumn && draggedColumn !== id) {
                        const order = headers.map((header) => header.column.id);
                        const from = order.indexOf(draggedColumn);
                        const to = order.indexOf(id);
                        order.splice(from, 1);
                        order.splice(to, 0, draggedColumn);
                        table.getColumn(draggedColumn)?.pin(pinned);
                        if (pinned) {
                          table.setColumnPinning((previous) => ({
                            ...previous,
                            [pinned]: order.filter((column) =>
                              previous[pinned].includes(column)
                            ),
                          }));
                        }
                        updateGridState(() => ({
                          columnOrder: order,
                        }));
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
                        updateGridState((previous) => {
                          const filters = { ...previous.columnFilters };
                          if (spec)
                            filters[id] = {
                              columnId: id,
                              filterType: type,
                              spec,
                            };
                          else delete filters[id];
                          return { columnFilters: filters };
                        });
                      }}
                    />
                    <ColumnResizeHandle
                      name={id}
                      size={header.getSize()}
                      minSize={40}
                      maxSize={800}
                      resizing={header.column.getIsResizing()}
                      onMouseDown={header.getResizeHandler()}
                      onTouchStart={header.getResizeHandler()}
                      onResize={(size) =>
                        updateGridState((previous) => ({
                          columnSizing: {
                            ...previous.columnSizing,
                            [id]: size,
                          },
                        }))
                      }
                      onReset={() => autoSize(id)}
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
          persistScroll={false}
          initialScrollOffset={initialScroll.top}
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
              {row.getVisibleCells().map((cell) => (
                <div
                  key={cell.id}
                  role="gridcell"
                  className={clsx(
                    styles.cell,
                    cell.column.getIsPinned() && styles.pinned
                  )}
                  style={{
                    width: cell.column.getSize(),
                    left:
                      cell.column.getIsPinned() === "start"
                        ? cell.column.getStart("start") + 60
                        : undefined,
                    right:
                      cell.column.getIsPinned() === "end"
                        ? cell.column.getAfter("end")
                        : undefined,
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
