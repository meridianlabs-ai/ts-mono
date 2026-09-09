import type { Condition } from "@tsmono/inspect-common/query";

import { specToCondition } from "./specToCondition";
import { isColumnFilter } from "./types";

/**
 * AND-combine a scope's per-column filter specs into a single `Condition`
 * (`undefined` when none are active). Entries are `unknown` because they come
 * from persisted grid state: pre-FilterSpec builds stored a compiled
 * `condition` instead of a `spec`, and those fail the guard and are dropped.
 *
 * @param excludeColumnId - Optional column ID to exclude, so a column's own
 * editor can fetch suggestions constrained by every *other* active filter.
 */
export function combineFilters(
  columnFilters: Record<string, unknown> | undefined,
  excludeColumnId?: string
): Condition | undefined {
  if (!columnFilters) return undefined;
  return Object.values(columnFilters)
    .map((f) =>
      isColumnFilter(f) && f.columnId !== excludeColumnId
        ? specToCondition(f.columnId, f.filterType, f.spec)
        : null
    )
    .filter((c): c is Condition => c !== null && c !== undefined)
    .reduce<Condition | undefined>(
      (acc, c) => (acc ? acc.and(c) : c),
      undefined
    );
}
