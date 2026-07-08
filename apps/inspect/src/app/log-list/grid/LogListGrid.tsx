import type { SortingState } from "@tanstack/react-table";
import clsx from "clsx";
import {
  FC,
  KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";

import type {
  ColumnFilter,
  FilterSpec,
  FilterType,
} from "@tsmono/inspect-components/columnFilter";
import { useProperty } from "@tsmono/react/hooks";

import { FindBandUI } from "../../../components/FindBandUI";
import { useLogsListing } from "../../../state/hooks";
import { DataGrid } from "../../shared/data-grid/DataGrid";
import {
  buildSearchIndex,
  findMatches,
} from "../../shared/data-grid/findMatches";
import gridStyles from "../../shared/gridCells.module.css";

import {
  useLogListColumns,
  type LogListMode,
  type ScoresViewMode,
} from "./columns/hooks";
import { LogListRow } from "./columns/types";

interface LogListGridProps {
  /** Display rows from `useLogListData` (folders pinned, files
   *  filtered+sorted). */
  rows: LogListRow[];
  /** Pre-filter row count (drives the empty-state loading indicator, which
   *  shouldn't show when filters merely matched nothing). */
  totalRowCount: number;
  /** The sorting/filters the rows were produced under (controlled DataGrid
   *  state; changes persist via `setGridState`). */
  sorting: SortingState;
  columnFilters?: Record<string, ColumnFilter>;
  currentPath?: string;
  // Identifies the data scope of the current view (mode + directory). The
  // grid is keyed on this so switching scope (folder/tasks) gets a fresh
  // grid (scroll + selection reset). `undefined` means logDir is still
  // hydrating.
  scopeKey?: string;
  mode?: LogListMode;
  /** The listing is still being brought up to date (drives the empty-state
   *  loading indicator). */
  busy: boolean;
}

export const LogListGrid: FC<LogListGridProps> = ({
  rows,
  totalRowCount,
  sorting,
  columnFilters,
  currentPath,
  scopeKey,
  mode = "logs",
  busy,
}) => {
  const { gridStateByScope, setGridState } = useLogsListing();

  const navigate = useNavigate();

  // Scope the column list to the current folder's logs in folder (logs) mode.
  const scopePrefix = mode === "logs" ? currentPath : undefined;
  // Read the same shared view-mode property LogsPanel writes to, so the
  // grid's column set always matches the picker's current selection.
  const [scoresViewMode] = useProperty<ScoresViewMode>(
    "log-list-scores-view",
    "mode",
    { defaultValue: "by-metric" }
  );
  const { columns, visibility } = useLogListColumns(
    mode,
    scopePrefix,
    scoresViewMode
  );

  const handleRowActivate = useCallback(
    (row: LogListRow) => {
      if (row.url) void navigate(row.url);
    },
    [navigate]
  );

  // Per-scope persisted column widths.
  const columnSizing = useMemo(
    () => (scopeKey ? gridStateByScope[scopeKey]?.columnSizing : undefined),
    [gridStateByScope, scopeKey]
  );

  // Per-scope persisted column order (drag-to-reorder).
  const columnOrder = useMemo(
    () => (scopeKey ? gridStateByScope[scopeKey]?.columnOrder : undefined),
    [gridStateByScope, scopeKey]
  );

  // Per-scope persisted row selection — restored on remount (e.g. after
  // navigating into a log and back) so the highlight and the arrow-key
  // anchor survive, matching the prior AG grid.
  const persistedSelectedId = useMemo(
    () => (scopeKey ? gridStateByScope[scopeKey]?.selectedRowId : undefined),
    [gridStateByScope, scopeKey]
  );

  const handleSortingChange = useCallback(
    (next: SortingState) => {
      if (scopeKey)
        setGridState(scopeKey, {
          sorting: next,
          columnFilters,
          columnSizing,
          columnOrder,
          selectedRowId: persistedSelectedId,
        });
    },
    [
      scopeKey,
      setGridState,
      columnFilters,
      columnSizing,
      columnOrder,
      persistedSelectedId,
    ]
  );

  const handleColumnFilterChange = useCallback(
    (columnId: string, filterType: FilterType, spec: FilterSpec | null) => {
      if (!scopeKey) return;
      const next: Record<string, ColumnFilter> = { ...columnFilters };
      if (spec === null) {
        delete next[columnId];
      } else {
        next[columnId] = { columnId, filterType, spec };
      }
      setGridState(scopeKey, {
        sorting,
        columnFilters: next,
        columnSizing,
        columnOrder,
        selectedRowId: persistedSelectedId,
      });
    },
    [
      scopeKey,
      setGridState,
      sorting,
      columnFilters,
      columnSizing,
      columnOrder,
      persistedSelectedId,
    ]
  );

  const handleColumnSizingChange = useCallback(
    (next: Record<string, number>) => {
      if (scopeKey)
        setGridState(scopeKey, {
          sorting,
          columnFilters,
          columnSizing: next,
          columnOrder,
          selectedRowId: persistedSelectedId,
        });
    },
    [
      scopeKey,
      setGridState,
      sorting,
      columnFilters,
      columnOrder,
      persistedSelectedId,
    ]
  );

  const handleColumnOrderChange = useCallback(
    (next: string[]) => {
      if (scopeKey)
        setGridState(scopeKey, {
          sorting,
          columnFilters,
          columnSizing,
          columnOrder: next,
          selectedRowId: persistedSelectedId,
        });
    },
    [
      scopeKey,
      setGridState,
      sorting,
      columnFilters,
      columnSizing,
      persistedSelectedId,
    ]
  );

  const persistSelectedId = useCallback(
    (id: string | undefined) => {
      if (scopeKey)
        setGridState(scopeKey, {
          sorting,
          columnFilters,
          columnSizing,
          columnOrder,
          selectedRowId: id,
        });
    },
    [scopeKey, setGridState, sorting, columnFilters, columnSizing, columnOrder]
  );

  const handleSelectedRowChange = useCallback(
    (row: LogListRow) => persistSelectedId(row.id),
    [persistSelectedId]
  );

  // Find (Cmd/Ctrl+F) — data-level search so matches include rows outside
  // the virtualized window. The active match drives `selectedRowId`, which
  // the DataGrid keeps scrolled into view.
  const [showFind, setShowFind] = useState(false);
  const [findTerm, setFindTerm] = useState("");
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const findInputRef = useRef<HTMLInputElement>(null);

  const closeFind = useCallback(() => {
    setShowFind(false);
    setFindTerm("");
    setCurrentMatchIndex(0);
  }, []);

  const searchColumns = useMemo(
    () => columns.filter((col) => col.id !== undefined && visibility[col.id]),
    [columns, visibility]
  );

  // Built only while the band is open; per-row text is then cached across
  // keystrokes (each keystroke just re-scans the index).
  const searchIndex = useMemo(
    () =>
      showFind
        ? buildSearchIndex(rows, searchColumns, (row) => row.id)
        : undefined,
    [showFind, rows, searchColumns]
  );
  const matchIds = useMemo(
    () => (searchIndex ? findMatches(searchIndex, findTerm) : []),
    [searchIndex, findTerm]
  );

  const handleFindTermChange = useCallback(() => {
    setFindTerm(findInputRef.current?.value ?? "");
    // New term: jump back to the first match.
    setCurrentMatchIndex(0);
  }, []);

  const goToMatch = useCallback(
    (index: number) => {
      if (matchIds.length === 0) return;
      setCurrentMatchIndex(
        ((index % matchIds.length) + matchIds.length) % matchIds.length
      );
    },
    [matchIds.length]
  );

  // Clamp: a data flush can shrink the match list under a stale index.
  const activeMatchIndex = Math.min(
    currentMatchIndex,
    Math.max(matchIds.length - 1, 0)
  );
  const activeMatchId =
    matchIds.length > 0 ? matchIds[activeMatchIndex] : undefined;

  // Persist each active find match as the selection so the last match stays
  // selected once the band closes (matches the AG grid). `selectedRowId`
  // already prefers `activeMatchId` while the band is open; this keeps the
  // persisted value in step so closing it doesn't snap back to the prior row.
  useEffect(() => {
    if (showFind && activeMatchId !== undefined) {
      persistSelectedId(activeMatchId);
    }
  }, [showFind, activeMatchId, persistSelectedId]);

  const handleFindInputKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        closeFind();
      } else if (e.key === "Enter") {
        e.preventDefault();
        goToMatch(activeMatchIndex + (e.shiftKey ? -1 : 1));
      }
    },
    [goToMatch, activeMatchIndex, closeFind]
  );

  useEffect(() => {
    const handleFindKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        e.stopPropagation();
        setShowFind(true);
        setTimeout(() => findInputRef.current?.focus(), 100);
      }
      if (e.key === "Escape" && showFind) {
        closeFind();
      }
    };
    // Capture phase so the shortcut wins before the browser's own find.
    document.addEventListener("keydown", handleFindKeyDown, true);
    return () =>
      document.removeEventListener("keydown", handleFindKeyDown, true);
  }, [closeFind, showFind]);

  return (
    <div className={clsx(gridStyles.gridWrapper)}>
      {showFind && (
        <FindBandUI
          inputRef={findInputRef}
          value={findTerm}
          onChange={handleFindTermChange}
          onKeyDown={handleFindInputKeyDown}
          onClose={closeFind}
          onPrevious={() => goToMatch(activeMatchIndex - 1)}
          onNext={() => goToMatch(activeMatchIndex + 1)}
          disableNav={matchIds.length === 0}
          noResults={!!findTerm && matchIds.length === 0}
          matchCount={findTerm ? matchIds.length : undefined}
          matchIndex={findTerm ? activeMatchIndex : undefined}
        />
      )}
      <div className={clsx(gridStyles.gridContainer)}>
        <DataGrid<LogListRow>
          key={scopeKey ?? "pending"}
          data={rows}
          columns={columns}
          columnVisibility={visibility}
          sorting={sorting}
          onSortingChange={handleSortingChange}
          columnFilters={columnFilters}
          onColumnFilterChange={handleColumnFilterChange}
          columnSizing={columnSizing}
          onColumnSizingChange={handleColumnSizingChange}
          columnOrder={columnOrder}
          onColumnOrderChange={handleColumnOrderChange}
          getRowId={(row) => row.id}
          selectedRowId={activeMatchId ?? persistedSelectedId}
          onSelectedRowChange={handleSelectedRowChange}
          onRowActivate={handleRowActivate}
          autoFocus
          ariaLabel="Evaluation logs"
          loading={totalRowCount === 0 && busy}
        />
      </div>
    </div>
  );
};
