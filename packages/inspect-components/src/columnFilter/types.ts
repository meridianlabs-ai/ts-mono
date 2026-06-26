import type { SimpleCondition } from "@tsmono/inspect-common/query";

/** Column value kind, selecting the filter editor + operator set. */
export type FilterType =
  | "string"
  | "number"
  | "boolean"
  | "date"
  | "datetime"
  | "duration"
  | "unknown";

/** A single column's active filter (keyed by columnId in grid state). */
export interface ColumnFilter {
  columnId: string;
  filterType: FilterType;
  condition: SimpleCondition | null;
}
