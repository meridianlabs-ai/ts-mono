import { Condition } from "../../query";
import { SimpleCondition } from "../../query/types";
import { ScansTableState, useStore } from "../../state/store";

/**
 * Build a combined filter condition from scans column filters.
 * @param excludeColumnId - Optional column ID to exclude from the condition
 */
export const useScanFilterConditions = (excludeColumnId?: string) => {
  // The applied filters. Table state is rehydrated from persisted storage;
  // snapshots written by older builds may lack this field.
  const columnFilters =
    useStore(
      (state) =>
        state.scansTableState.columnFilters as
          ScansTableState["columnFilters"] | undefined
    ) ?? {};

  // Get conditions, optionally excluding a specific column
  const filterConditions = Object.values(columnFilters)
    .filter((filter) => !excludeColumnId || filter.columnId !== excludeColumnId)
    .map((filter) => filter.condition)
    .filter((condition): condition is SimpleCondition => Boolean(condition));

  // Reduce to a single condition using 'and'
  const condition = filterConditions.reduce<Condition | undefined>(
    (acc, condition) => (acc ? acc.and(condition) : condition),
    undefined
  );
  return condition;
};
