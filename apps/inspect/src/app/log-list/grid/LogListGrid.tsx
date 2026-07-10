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
  const { gridStateByScope, patchGridState } = useLogsListing();

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
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      if (row.url) navigate(row.url);
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
      if (scopeKey) patchGridState(scopeKey, { sorting: next });
    },
    [scopeKey, patchGridState]
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
      patchGridState(scopeKey, { columnFilters: next });
    },
    [scopeKey, patchGridState, columnFilters]
  );

  const handleColumnSizingChange = useCallback(
    (next: Record<string, number>) => {
      if (scopeKey) patchGridState(scopeKey, { columnSizing: next });
    },
    [scopeKey, patchGridState]
  );

  const handleColumnOrderChange = useCallback(
    (next: string[]) => {
      if (scopeKey) patchGridState(scopeKey, { columnOrder: next });
    },
    [scopeKey, patchGridState]
  );

  const persistSelectedId = useCallback(
    (id: string | undefined) => {
      if (scopeKey) patchGridState(scopeKey, { selectedRowId: id });
    },
    [scopeKey, patchGridState]
  );

  // Armed while the find band is open with an active match; closing the band
  // or unmounting persists it as the selection (see below). An explicit row
  // selection disarms it so the stale match can't clobber the user's click —
  // navigating matches again re-arms via the sync effect.
  const openBandMatchIdRef = useRef<string | undefined>(undefined);

  const handleSelectedRowChange = useCallback(
    (row: LogListRow) => {
      openBandMatchIdRef.current = undefined;
      persistSelectedId(row.id);
    },
    [persistSelectedId]
  );

  // Find (Cmd/Ctrl+F) — data-level search so matches include rows outside
  // the virtualized window. The active match drives `selectedRowId`, which
  // the DataGrid keeps scrolled into view.
  const [showFind, setShowFind] = useState(false);
  const [findTerm, setFindTerm] = useState("");
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const findInputRef = useRef<HTMLInputElement>(null);

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

  const closeFind = useCallback(() => {
    // Persist the armed match as the selection so closing the band doesn't
    // snap back to the prior row (matches the AG grid). Display prefers
    // `activeMatchId` while the band is open, so the persisted value only
    // matters from this point on. Reads the ref (not `activeMatchId`) so a
    // row click since the last match navigation wins instead.
    const id = openBandMatchIdRef.current;
    if (id !== undefined) persistSelectedId(id);
    openBandMatchIdRef.current = undefined;
    setShowFind(false);
    setFindTerm("");
    setCurrentMatchIndex(0);
  }, [persistSelectedId]);

  // Same persistence for the leave-without-closing path: unmounting (e.g.
  // navigating away) with the band still open. Ref carries the latest match
  // so the cleanup — which runs long after this render — doesn't act on a
  // stale closure.
  useEffect(() => {
    openBandMatchIdRef.current = showFind ? activeMatchId : undefined;
  }, [showFind, activeMatchId]);
  useEffect(
    () => () => {
      const id = openBandMatchIdRef.current;
      if (id !== undefined) persistSelectedId(id);
    },
    [persistSelectedId]
  );

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
