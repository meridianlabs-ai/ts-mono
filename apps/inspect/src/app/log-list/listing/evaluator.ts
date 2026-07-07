import type {
  Condition,
  OperatorModel,
  OrderByModel,
} from "@tsmono/inspect-common/query";
import type { FilterType } from "@tsmono/inspect-components/columnFilter";

import type {
  FilterTypeAccessor,
  ValueAccessor,
  ValueComparator,
} from "./types";

/**
 * TRANSITIONAL: client-side evaluation of a `Condition` / `OrderBy` against
 * in-memory rows. Inspect will eventually filter/sort server-side (like scout),
 * at which point this module is deleted. Keep it self-contained.
 */

const isNullish = (v: unknown): boolean => v === null || v === undefined;

const regexEscapeChar = (ch: string): string =>
  ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Translate a SQL LIKE pattern (`%` = any, `_` = one char, `\` escapes the
 *  next char) to a RegExp. A trailing lone `\` matches a literal backslash. */
const likeToRegExp = (pattern: string, caseInsensitive: boolean): RegExp => {
  let out = "";
  let escaped = false;
  for (const ch of pattern) {
    if (escaped) {
      out += regexEscapeChar(ch);
      escaped = false;
    } else if (ch === "\\") {
      escaped = true;
    } else if (ch === "%") {
      out += ".*";
    } else if (ch === "_") {
      out += ".";
    } else {
      out += regexEscapeChar(ch);
    }
  }
  if (escaped) out += regexEscapeChar("\\");
  return new RegExp(`^${out}$`, caseInsensitive ? "is" : "s");
};

const matchesLike = (
  value: unknown,
  pattern: unknown,
  caseInsensitive: boolean
): boolean => {
  if (isNullish(value) || typeof pattern !== "string") return false;
  return likeToRegExp(pattern, caseInsensitive).test(String(value));
};

const lt = (a: unknown, b: unknown): boolean => {
  if (typeof a === "number" && typeof b === "number") return a < b;
  if (typeof a === "string" && typeof b === "string") return a < b;
  return false;
};

const toDate = (v: unknown): Date | null =>
  typeof v === "number" || typeof v === "string" || v instanceof Date
    ? new Date(v)
    : null;

/**
 * Coerce a value to a comparable form for the column's filter type, so the
 * row value and the filter operand compare like-for-like (numbers
 * numerically, dates by timestamp — day-truncated for `date`). Strings pass
 * through unchanged.
 */
const coerce = (v: unknown, filterType: FilterType | undefined): unknown => {
  if (v === null || v === undefined) return v;
  switch (filterType) {
    case "number":
    case "duration":
      return typeof v === "number" ? v : Number(v);
    case "date": {
      const d = toDate(v);
      return d
        ? new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
        : NaN;
    }
    case "datetime": {
      const d = toDate(v);
      return d ? d.getTime() : NaN;
    }
    case "boolean":
      return typeof v === "boolean" ? v : v === "true";
    default:
      return v;
  }
};

const applyOperator = (
  rawValue: unknown,
  operator: OperatorModel,
  rawRight: unknown,
  filterType: FilterType | undefined
): boolean => {
  // IS NULL / IS NOT NULL test the raw value before any coercion.
  if (operator === "IS NULL") return isNullish(rawValue);
  if (operator === "IS NOT NULL") return !isNullish(rawValue);

  const value = coerce(rawValue, filterType);
  const right = Array.isArray(rawRight)
    ? rawRight.map((r) => coerce(r, filterType))
    : coerce(rawRight, filterType);

  switch (operator) {
    case "=":
      return value === right;
    case "!=":
      return value !== right;
    case "<":
      return lt(value, right);
    case "<=":
      return value === right || lt(value, right);
    case ">":
      return lt(right, value);
    case ">=":
      return value === right || lt(right, value);
    case "IN":
      return Array.isArray(right) && right.includes(value);
    case "NOT IN":
      return Array.isArray(right) && !right.includes(value);
    case "LIKE":
      return matchesLike(value, right, false);
    case "NOT LIKE":
      return !matchesLike(value, right, false);
    case "ILIKE":
      return matchesLike(value, right, true);
    case "NOT ILIKE":
      return !matchesLike(value, right, true);
    case "BETWEEN":
      return (
        Array.isArray(right) &&
        right.length === 2 &&
        !lt(value, right[0]) &&
        !lt(right[1], value)
      );
    case "NOT BETWEEN":
      return !(
        Array.isArray(right) &&
        right.length === 2 &&
        !lt(value, right[0]) &&
        !lt(right[1], value)
      );
    default:
      return true;
  }
};

/** Evaluate a `Condition` tree against a row. `getFilterType` enables
 *  type-aware coercion of the compared values (dates/numbers). */
export function evaluateCondition<TRow>(
  row: TRow,
  condition: Condition,
  getValue: ValueAccessor<TRow>,
  getFilterType?: FilterTypeAccessor
): boolean {
  if (condition.compound) {
    switch (condition.operator) {
      case "AND":
        return (
          evaluateCondition(row, condition.left, getValue, getFilterType) &&
          (condition.right == null ||
            evaluateCondition(row, condition.right, getValue, getFilterType))
        );
      case "OR":
        return (
          evaluateCondition(row, condition.left, getValue, getFilterType) ||
          (condition.right != null &&
            evaluateCondition(row, condition.right, getValue, getFilterType))
        );
      case "NOT":
        return !evaluateCondition(row, condition.left, getValue, getFilterType);
      default:
        return true;
    }
  }
  return applyOperator(
    getValue(row, condition.left),
    condition.operator,
    condition.right,
    getFilterType?.(condition.left)
  );
}

// Default (string-ish) compare: missing values sort last in both directions
// (the `isDescending`-aware sentinel mirrors the AG number comparator).
const defaultCompare: ValueComparator = (a, b, isDescending) => {
  const am = isNullish(a) || a === "";
  const bm = isNullish(b) || b === "";
  if (am && bm) return 0;
  if (am) return isDescending ? -1 : 1;
  if (bm) return isDescending ? 1 : -1;
  if (lt(a, b)) return -1;
  if (lt(b, a)) return 1;
  return 0;
};

/**
 * Build a row comparator from an `OrderBy` list. Emulates AG Grid's model:
 * call the per-column comparator with `isDescending`, then reverse its result
 * for descending — so comparators that pin missing values last stay correct in
 * both directions.
 */
export function compareByOrderBy<TRow>(
  orderBy: OrderByModel[],
  getValue: ValueAccessor<TRow>,
  getComparator: (columnId: string) => ValueComparator | undefined
): (a: TRow, b: TRow) => number {
  return (a, b) => {
    for (const { column, direction } of orderBy) {
      const desc = direction === "DESC";
      const cmp = getComparator(column) ?? defaultCompare;
      let result = cmp(getValue(a, column), getValue(b, column), desc);
      if (desc) result = -result;
      if (result !== 0) return result;
    }
    return 0;
  };
}
