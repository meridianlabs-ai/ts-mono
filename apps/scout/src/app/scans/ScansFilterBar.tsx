import { FC, useCallback } from "react";

import type { PickerColumn } from "@tsmono/inspect-components/dataGrid";

import { ScalarValue } from "../../api/api";
import { ScansTableState, useStore } from "../../state/store";
import { useAddFilterPopover } from "../components/columnFilter";
import { FilterBar } from "../components/FilterBar";
import { useFilterBarHandlers } from "../components/useFilterBarHandlers";

import {
  COLUMN_HEADER_TITLES,
  COLUMN_LABELS,
  DEFAULT_COLUMN_ORDER,
  DEFAULT_VISIBLE_COLUMNS,
  FILTER_COLUMNS,
  isScanColumnKey,
  ScanColumnKey,
} from "./columns";

const PICKER_COLUMNS: PickerColumn[] = DEFAULT_COLUMN_ORDER.map((key) => ({
  id: key,
  label: COLUMN_LABELS[key],
  title: `${key}\n${COLUMN_HEADER_TITLES[key]}`,
}));

export const ScansFilterBar: FC<{
  includeColumnPicker?: boolean;
  filterSuggestions?: ScalarValue[];
  onFilterColumnChange?: (columnId: string | null) => void;
}> = ({
  includeColumnPicker = true,
  filterSuggestions = [],
  onFilterColumnChange,
}) => {
  // Scans Filter State
  const filters = useStore((state) => state.scansTableState.columnFilters);
  const visibleColumns = useStore(
    (state) => state.scansTableState.visibleColumns
  );
  const setScansTableState = useStore((state) => state.setScansTableState);

  // Use shared filter bar handlers
  const { handleFilterChange, removeFilter, handleAddFilter } =
    useFilterBarHandlers<ScanColumnKey, ScansTableState>({
      setTableState: setScansTableState,
      defaultVisibleColumns: DEFAULT_VISIBLE_COLUMNS,
      isColumnKey: isScanColumnKey,
    });

  // Add filter popover state
  const addFilterPopover = useAddFilterPopover({
    columns: FILTER_COLUMNS,
    filters,
    onAddFilter: handleAddFilter,
    onFilterColumnChange,
  });

  // Handle visible columns change
  const handleVisibleColumnsChange = useCallback(
    (newVisibleColumns: string[]) => {
      setScansTableState((prevState) => ({
        ...prevState,
        visibleColumns: newVisibleColumns.filter(isScanColumnKey),
      }));
    },
    [setScansTableState]
  );

  return (
    <FilterBar
      filters={filters}
      onFilterChange={handleFilterChange}
      onRemoveFilter={removeFilter}
      filterSuggestions={filterSuggestions}
      onFilterColumnChange={onFilterColumnChange}
      popoverIdPrefix="scans"
      addFilterPopoverState={addFilterPopover}
      columns={includeColumnPicker ? PICKER_COLUMNS : undefined}
      visibleColumns={visibleColumns ?? DEFAULT_VISIBLE_COLUMNS}
      defaultVisibleColumns={DEFAULT_VISIBLE_COLUMNS}
      onVisibleColumnsChange={
        includeColumnPicker ? handleVisibleColumnsChange : undefined
      }
    />
  );
};
