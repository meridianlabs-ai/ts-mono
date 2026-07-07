/** Column value kind, selecting the filter editor + operator set. */
export type FilterType =
  | "string"
  | "number"
  | "boolean"
  | "date"
  | "datetime"
  | "duration"
  | "unknown";

export const UI_OPERATORS = [
  "contains",
  "does not contain",
  "starts with",
  "ends with",
  "=",
  "!=",
  "<",
  "<=",
  ">",
  ">=",
  "in",
  "not in",
  "between",
  "not between",
  "is blank",
  "is not blank",
] as const;

/**
 * UI-level filter operator — what the user picks in the popover. Compiled at
 * the query boundary into a wire `Condition` (log list) or a filtrex fragment
 * (samples page, future). Deliberately distinct from the generated
 * `OperatorModel` wire enum, which cannot carry UI-only operators like
 * `contains`.
 */
export type UiOperator = (typeof UI_OPERATORS)[number];

/**
 * A column filter as edited and persisted: the operator plus the raw input
 * strings exactly as typed, so reopening the editor restores what the user
 * entered. Compilation (and input parsing) happens at read time.
 */
export interface FilterSpec {
  operator: UiOperator;
  value: string;
  /** Range end for between/not between. */
  value2?: string;
}

/** A single column's active filter (keyed by columnId in grid state). */
export interface ColumnFilter {
  columnId: string;
  filterType: FilterType;
  spec: FilterSpec;
}

/**
 * Runtime guard for entries read from persisted grid state. Pre-FilterSpec
 * builds stored a compiled `condition` instead of a `spec`; those entries are
 * unusable anyway (JSON rehydration strips the ConditionBuilder prototype, so
 * `.and()` would crash) and are dropped by callers using this guard.
 */
export const isColumnFilter = (value: unknown): value is ColumnFilter => {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.columnId !== "string" || typeof v.filterType !== "string") {
    return false;
  }
  const spec = v.spec as Record<string, unknown> | undefined;
  return (
    typeof spec === "object" &&
    spec !== null &&
    typeof spec.operator === "string" &&
    (UI_OPERATORS as readonly string[]).includes(spec.operator) &&
    typeof spec.value === "string" &&
    (spec.value2 === undefined || typeof spec.value2 === "string")
  );
};
