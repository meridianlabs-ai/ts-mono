import type { FilterType, UiOperator } from "./types";

const STRING_OPERATORS: UiOperator[] = [
  "contains",
  "does not contain",
  "starts with",
  "ends with",
  "=",
  "!=",
  "in",
  "not in",
  "is blank",
  "is not blank",
];

const NUMBER_OPERATORS: UiOperator[] = [
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
];

const DATE_OPERATORS: UiOperator[] = [
  "=",
  "!=",
  "<",
  "<=",
  ">",
  ">=",
  "between",
  "not between",
  "is blank",
  "is not blank",
];

/** Default operator choices per column type (pages may pass a narrower set). */
export const OPERATORS_BY_TYPE: Record<FilterType, UiOperator[]> = {
  string: STRING_OPERATORS,
  number: NUMBER_OPERATORS,
  boolean: ["=", "!=", "is blank", "is not blank"],
  date: DATE_OPERATORS,
  datetime: DATE_OPERATORS,
  duration: NUMBER_OPERATORS,
  unknown: STRING_OPERATORS,
};

/** Operators that take no value (the value input is disabled). */
export const NO_VALUE_OPERATORS: ReadonlySet<UiOperator> = new Set([
  "is blank",
  "is not blank",
]);

/** Operators whose value is a comma-separated list. */
export const LIST_VALUE_OPERATORS: ReadonlySet<UiOperator> = new Set([
  "in",
  "not in",
]);

/** Operators that take a start + end value pair. */
export const RANGE_VALUE_OPERATORS: ReadonlySet<UiOperator> = new Set([
  "between",
  "not between",
]);
