import { useCallback, useMemo } from "react";

import type {
  ColumnFilter,
  FilterSpec,
} from "@tsmono/inspect-components/columnFilter";

/**
 * Base table state interface that filter bar handlers can work with.
 * Both ScansTableState and TranscriptsTableState conform to this.
 */
interface BaseTableState<TColumnKey extends string = string> {
  columnFilters: Record<string, ColumnFilter>;
  visibleColumns?: TColumnKey[];
  columnOrder: string[];
}

interface FilterBarHandlers {
  /**
   * Update a filter's spec or remove it if spec is null
   */
  handleFilterChange: (columnId: string, spec: FilterSpec | null) => void;
  /**
   * Remove a filter by column ID
   */
  removeFilter: (column: string) => void;
  /**
   * Add a new filter, ensuring the column is visible
   */
  handleAddFilter: (filter: ColumnFilter) => void;
}

/**
 * Creates filter bar handler functions for a table state.
 * This is the core logic shared between scans and transcripts filter bars.
 *
 * @param setTableState - Store setter function
 * @param defaultVisibleColumns - Default columns when state doesn't have them
 * @returns Object with handler functions
 */
function createFilterBarHandlers<
  TColumnKey extends string,
  TState extends BaseTableState<TColumnKey> = BaseTableState<TColumnKey>,
>(
  setTableState: (updater: TState | ((prev: TState) => TState)) => void,
  defaultVisibleColumns: readonly TColumnKey[],
  isColumnKey: (columnId: string) => columnId is TColumnKey
): FilterBarHandlers {
  const handleFilterChange = (columnId: string, spec: FilterSpec | null) => {
    setTableState((prevState) => {
      const newFilters = { ...prevState.columnFilters };
      if (spec === null) {
        delete newFilters[columnId];
      } else {
        const existingFilter = newFilters[columnId];
        if (existingFilter) {
          newFilters[columnId] = {
            ...existingFilter,
            spec,
          };
        }
      }
      return {
        ...prevState,
        columnFilters: newFilters,
      };
    });
  };

  const removeFilter = (column: string) => {
    setTableState((prevState) => {
      const newFilters = { ...prevState.columnFilters };
      delete newFilters[column];
      return {
        ...prevState,
        columnFilters: newFilters,
      };
    });
  };

  const handleAddFilter = (filter: ColumnFilter) => {
    setTableState((prevState) => {
      const withFilter = {
        ...prevState,
        columnFilters: {
          ...prevState.columnFilters,
          [filter.columnId]: filter,
        },
      };

      // The filter itself applies whatever the column; only the visibility
      // bookkeeping below needs a column this table knows about.
      if (!isColumnKey(filter.columnId)) {
        return withFilter;
      }
      const columnKey = filter.columnId;

      // Use default visible columns if not set in state
      const currentVisibleColumns = prevState.visibleColumns ?? [
        ...defaultVisibleColumns,
      ];

      // Check if we need to add this column to visible columns
      const needsColumnVisible = !currentVisibleColumns.includes(columnKey);

      // Check if we need to add this column to column order
      const columnOrder = prevState.columnOrder;
      const needsColumnOrder =
        columnOrder.length > 0 && !columnOrder.includes(columnKey);

      return {
        ...withFilter,
        // Add the column to visible columns if it's not already there
        ...(needsColumnVisible && {
          visibleColumns: [...currentVisibleColumns, columnKey],
        }),
        // Add the column to column order if it's not already there
        ...(needsColumnOrder && {
          columnOrder: [...columnOrder, columnKey],
        }),
      };
    });
  };

  return {
    handleFilterChange,
    removeFilter,
    handleAddFilter,
  };
}

interface UseFilterBarHandlersOptions<
  TColumnKey extends string,
  TState extends BaseTableState<TColumnKey> = BaseTableState<TColumnKey>,
> {
  /**
   * Store setter function that accepts an updater
   */
  setTableState: (updater: TState | ((prev: TState) => TState)) => void;
  /**
   * Default visible columns to use when state doesn't have them set
   */
  defaultVisibleColumns: readonly TColumnKey[];
  /**
   * Narrows an arbitrary filter's column id to one of this table's columns —
   * the visibility bookkeeping only applies to columns the table declares.
   */
  isColumnKey: (columnId: string) => columnId is TColumnKey;
}

/**
 * Hook that provides common filter bar handlers for both scans and transcripts tables.
 * Extracts the duplicated logic from ScansFilterBar and TranscriptFilterBar.
 */
export function useFilterBarHandlers<
  TColumnKey extends string,
  TState extends BaseTableState<TColumnKey> = BaseTableState<TColumnKey>,
>({
  setTableState,
  defaultVisibleColumns,
  isColumnKey,
}: UseFilterBarHandlersOptions<TColumnKey, TState>): FilterBarHandlers {
  // Memoize the handlers to maintain referential stability
  const handlers = useMemo(
    () =>
      createFilterBarHandlers(
        setTableState,
        defaultVisibleColumns,
        isColumnKey
      ),
    [setTableState, defaultVisibleColumns, isColumnKey]
  );

  // Wrap in useCallback for consistent return types
  const handleFilterChange = useCallback(
    (columnId: string, spec: FilterSpec | null) => {
      handlers.handleFilterChange(columnId, spec);
    },
    [handlers]
  );

  const removeFilter = useCallback(
    (column: string) => {
      handlers.removeFilter(column);
    },
    [handlers]
  );

  const handleAddFilter = useCallback(
    (filter: ColumnFilter) => {
      handlers.handleAddFilter(filter);
    },
    [handlers]
  );

  return {
    handleFilterChange,
    removeFilter,
    handleAddFilter,
  };
}
