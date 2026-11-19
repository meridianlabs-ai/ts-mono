import { FC, useCallback } from "react";

import type { PickerColumn } from "@tsmono/inspect-components/dataGrid";

import { ScalarValue } from "../../api/api";
import { TranscriptsTableState, useStore } from "../../state/store";
import type { TranscriptInfo } from "../../types/api-types";
import { useAddFilterPopover } from "../components/columnFilter";
import { FilterBar } from "../components/FilterBar";
import { useFilterBarHandlers } from "../components/useFilterBarHandlers";

import {
  COLUMN_HEADER_TITLES,
  COLUMN_LABELS,
  DEFAULT_COLUMN_ORDER,
  DEFAULT_VISIBLE_COLUMNS,
  FILTER_COLUMNS,
  isTranscriptColumnKey,
} from "./columns";

const PICKER_COLUMNS: PickerColumn[] = DEFAULT_COLUMN_ORDER.map((key) => ({
  id: key,
  label: COLUMN_LABELS[key],
  title: `${key}\n${COLUMN_HEADER_TITLES[key]}`,
}));

export const TranscriptFilterBar: FC<{
  filterCodeValues?: Record<string, string>;
  filterSuggestions?: ScalarValue[];
  onFilterColumnChange?: (columnId: string | null) => void;
  includeColumnPicker?: boolean;
}> = ({
  filterCodeValues,
  filterSuggestions = [],
  onFilterColumnChange,
  includeColumnPicker = true,
}) => {
  // Transcript Filter State
  const filters = useStore(
    (state) => state.transcriptsTableState.columnFilters
  );
  const visibleColumns = useStore(
    (state) => state.transcriptsTableState.visibleColumns
  );
  const setTranscriptsTableState = useStore(
    (state) => state.setTranscriptsTableState
  );

  // Use shared filter bar handlers
  const { handleFilterChange, removeFilter, handleAddFilter } =
    useFilterBarHandlers<keyof TranscriptInfo, TranscriptsTableState>({
      setTableState: setTranscriptsTableState,
      defaultVisibleColumns: DEFAULT_VISIBLE_COLUMNS,
      isColumnKey: isTranscriptColumnKey,
    });

  // Handle visible columns change
  const handleVisibleColumnsChange = useCallback(
    (newVisibleColumns: string[]) => {
      setTranscriptsTableState((prevState) => ({
        ...prevState,
        visibleColumns: newVisibleColumns.filter(isTranscriptColumnKey),
      }));
    },
    [setTranscriptsTableState]
  );

  // Add filter popover state
  const addFilterPopover = useAddFilterPopover({
    columns: FILTER_COLUMNS,
    filters,
    onAddFilter: handleAddFilter,
    onFilterColumnChange,
  });

  return (
    <FilterBar
      filters={filters}
      onFilterChange={handleFilterChange}
      onRemoveFilter={removeFilter}
      filterCodeValues={filterCodeValues ?? {}}
      filterSuggestions={filterSuggestions}
      onFilterColumnChange={onFilterColumnChange}
      popoverIdPrefix="transcript"
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
