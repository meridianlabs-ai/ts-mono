import type { Condition, SimpleCondition } from "@tsmono/inspect-common/query";
import type { ColumnFilter } from "@tsmono/inspect-components/columnFilter";

/**
 * AND-combine a scope's per-column filters into a single `Condition`
 * (`undefined` when none are active). Mirrors scout's `useFilterConditions`.
 */
export function combineFilters(
  columnFilters: Record<string, ColumnFilter> | undefined
): Condition | undefined {
  if (!columnFilters) return undefined;
  return Object.values(columnFilters)
    .map((f) => f.condition)
    .filter((c): c is SimpleCondition => c !== null)
    .reduce<Condition | undefined>(
      (acc, c) => (acc ? acc.and(c) : c),
      undefined
    );
}
