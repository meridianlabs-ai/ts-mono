import { combineFilters } from "@tsmono/inspect-components/columnFilter";

import { useStore } from "../../state/store";

/**
 * Build a combined filter condition from column filters.
 * @param excludeColumnId - Optional column ID to exclude from the condition
 */
export const useFilterConditions = (excludeColumnId?: string) => {
  const columnFilters = useStore(
    (state) => state.transcriptsTableState.columnFilters
  );
  return combineFilters(columnFilters, excludeColumnId);
};
