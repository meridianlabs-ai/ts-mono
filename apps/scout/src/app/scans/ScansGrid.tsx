import { FC, useMemo } from "react";

import { combineFilters } from "@tsmono/inspect-components/columnFilter";
import { DataGrid } from "@tsmono/inspect-components/dataGrid";
import { hashRouteUrl } from "@tsmono/react/routing";
import { toRelativePath } from "@tsmono/util";

import { ScalarValue } from "../../api/api";
import { useLoggingNavigate } from "../../debugging/navigationDebugging";
import { scanRoute } from "../../router/url";
import { useStore } from "../../state/store";
import type { ScanRow as ApiScanRow } from "../../types/api-types";

import {
  DEFAULT_COLUMN_ORDER,
  DEFAULT_VISIBLE_COLUMNS,
  isScanColumnKey,
  SCAN_COLUMNS,
  ScanRow,
} from "./columns";

interface ScansGridProps {
  scans: ApiScanRow[];
  resultsDir: string | undefined;
  /** The directory the listing comes from: the user's choice or the config's */
  scansDir: string | undefined;
  className?: string;
  loading?: boolean;
  /** Called when scroll position nears end */
  onScrollNearEnd?: (distanceFromBottom?: number) => void;
  /** Whether more data is available to fetch */
  hasMore?: boolean;
  /** Distance from bottom (in px) at which to trigger callback */
  fetchThreshold?: number;
  /** Autocomplete suggestions for the currently editing filter column */
  filterSuggestions?: ScalarValue[];
  /** Called when a filter column starts/stops being edited */
  onFilterColumnChange?: (columnId: string | null) => void;
}

export const ScansGrid: FC<ScansGridProps> = ({
  scans,
  resultsDir,
  scansDir,
  className,
  loading,
  onScrollNearEnd,
  hasMore = false,
  fetchThreshold = 500,
  filterSuggestions,
  onFilterColumnChange,
}) => {
  const navigate = useLoggingNavigate("ScansGrid");
  const tableState = useStore((state) => state.scansTableState);
  const setTableState = useStore((state) => state.setScansTableState);
  const {
    sorting,
    columnOrder,
    columnSizing,
    focusedRowId,
    visibleColumns = DEFAULT_VISIBLE_COLUMNS,
    columnFilters,
  } = tableState;

  // Add computed relativeLocation to each scan
  const data = useMemo(
    (): ScanRow[] =>
      scans.map((scan) => ({
        ...scan,
        relativeLocation: toRelativePath(scan.location, resultsDir),
      })),
    [scans, resultsDir]
  );

  const routeOf = (row: ScanRow): string | undefined =>
    resultsDir ? scanRoute(resultsDir, row.relativeLocation) : undefined;

  const emptyMessage = !scansDir
    ? "No scans directory configured."
    : combineFilters(columnFilters)
      ? "No matching scans"
      : "No scans in this directory.";

  return (
    <DataGrid<ScanRow>
      data={data}
      columns={SCAN_COLUMNS}
      columnVisibility={Object.fromEntries(
        DEFAULT_COLUMN_ORDER.map((key) => [key, visibleColumns.includes(key)])
      )}
      getRowId={(row) => row.scan_id}
      ariaLabel="Scans"
      className={className}
      loading={loading}
      emptyMessage={emptyMessage}
      sorting={sorting}
      onSortingChange={(next) =>
        setTableState((prev) => ({ ...prev, sorting: next }))
      }
      columnOrder={columnOrder.length ? columnOrder : DEFAULT_COLUMN_ORDER}
      onColumnOrderChange={(next) =>
        setTableState((prev) => ({
          ...prev,
          columnOrder: next.filter(isScanColumnKey),
        }))
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
        setTableState((prev) => ({ ...prev, focusedRowId: row.scan_id }))
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
