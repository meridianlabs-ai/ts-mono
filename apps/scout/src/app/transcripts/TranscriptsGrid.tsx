import { FC } from "react";

import { combineFilters } from "@tsmono/inspect-components/columnFilter";
import { DataGrid } from "@tsmono/inspect-components/dataGrid";
import { hashRouteUrl } from "@tsmono/react/routing";

import { ScalarValue } from "../../api/api";
import { useLoggingNavigate } from "../../debugging/navigationDebugging";
import { transcriptRoute } from "../../router/url";
import { useStore } from "../../state/store";
import { TranscriptInfo } from "../../types/api-types";

import {
  DEFAULT_COLUMN_ORDER,
  DEFAULT_VISIBLE_COLUMNS,
  getTranscriptColumns,
} from "./columns";

interface TranscriptGridProps {
  transcripts: TranscriptInfo[];
  transcriptsDir?: string | null;
  /** Whether the project's scout.yaml filter narrows the listing */
  projectFiltered?: boolean;
  className?: string;
  /** Called when scroll position nears end; receives distance from bottom in px. */
  onScrollNearEnd: (distanceFromBottom: number) => void;
  /** Whether more data is available to fetch. */
  hasMore: boolean;
  /** Distance from bottom (in px) at which to trigger callback. */
  fetchThreshold: number;
  loading?: boolean;
  /** Autocomplete suggestions for the currently editing filter column */
  filterSuggestions?: ScalarValue[];
  /** Called when a filter column starts/stops being edited */
  onFilterColumnChange?: (columnId: string | null) => void;
}

export const TranscriptsGrid: FC<TranscriptGridProps> = ({
  transcripts,
  transcriptsDir,
  projectFiltered = false,
  className,
  onScrollNearEnd,
  hasMore,
  fetchThreshold,
  loading,
  filterSuggestions,
  onFilterColumnChange,
}) => {
  const navigate = useLoggingNavigate("TranscriptsGrid");
  const tableState = useStore((state) => state.transcriptsTableState);
  const setTableState = useStore((state) => state.setTranscriptsTableState);
  const {
    sorting,
    columnOrder,
    columnSizing,
    focusedRowId,
    visibleColumns = DEFAULT_VISIBLE_COLUMNS,
  } = tableState;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- persisted store state (#555): an older build's transcriptsTableState blob is merged wholesale, so keys added since may be absent
  const columnFilters = tableState.columnFilters ?? {};

  const routeOf = (row: TranscriptInfo): string | undefined =>
    transcriptsDir
      ? transcriptRoute(transcriptsDir, String(row.transcript_id))
      : undefined;

  const emptyMessage = !transcriptsDir
    ? "No transcripts directory configured."
    : projectFiltered || combineFilters(columnFilters)
      ? "No matching transcripts"
      : "No transcripts in this directory.";

  return (
    <DataGrid<TranscriptInfo>
      data={transcripts}
      columns={getTranscriptColumns(visibleColumns)}
      getRowId={(row) => String(row.transcript_id)}
      ariaLabel="Transcripts"
      className={className}
      loading={loading}
      emptyMessage={emptyMessage}
      sorting={sorting}
      onSortingChange={(next) =>
        setTableState((prev) => ({ ...prev, sorting: next }))
      }
      columnOrder={
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- persisted store state (#555): an older build's transcriptsTableState blob is merged wholesale, so keys added since may be absent
        columnOrder?.length ? columnOrder : DEFAULT_COLUMN_ORDER
      }
      onColumnOrderChange={(next) =>
        setTableState((prev) => ({ ...prev, columnOrder: next }))
      }
      columnSizing={columnSizing}
      onColumnSizingChange={(next) =>
        setTableState((prev) => ({ ...prev, columnSizing: next }))
      }
      columnFilters={columnFilters}
      onColumnFilterChange={(columnId, filterType, spec) =>
        setTableState((prev) => {
          const filters = { ...prev.columnFilters };
          if (spec === null) delete filters[columnId];
          else filters[columnId] = { columnId, filterType, spec };
          return { ...prev, columnFilters: filters };
        })
      }
      filterSuggestions={filterSuggestions}
      onFilterOpenChange={onFilterColumnChange}
      selectedRowId={focusedRowId ?? undefined}
      onSelectedRowChange={(row) =>
        setTableState((prev) => ({
          ...prev,
          focusedRowId: String(row.transcript_id),
        }))
      }
      onRowActivate={(row) => {
        const route = routeOf(row);
        if (route) navigate(route);
      }}
      getRowHref={(row) => {
        const route = routeOf(row);
        return route ? hashRouteUrl(route) : undefined;
      }}
      onScrollNearEnd={onScrollNearEnd}
      hasMore={hasMore}
      fetchThreshold={fetchThreshold}
    />
  );
};
