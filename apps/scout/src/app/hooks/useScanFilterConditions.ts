import { combineFilters } from "@tsmono/inspect-components/columnFilter";

import { useStore } from "../../state/store";

/**
 * Build a combined filter condition from scans column filters.
 * @param excludeColumnId - Optional column ID to exclude from the condition
 */
export const useScanFilterConditions = (excludeColumnId?: string) => {
  const columnFilters = useStore(
    (state) => state.scansTableState.columnFilters
  );
  return combineFilters(columnFilters, excludeColumnId);
};
