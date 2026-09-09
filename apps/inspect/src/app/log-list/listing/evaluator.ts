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

const lt = (a: unknown, b: unknown): boolean => {
  if (typeof a === "number" && typeof b === "number") return a < b;
  if (typeof a === "string" && typeof b === "string") return a < b;
  return false;
};

const lte = (a: unknown, b: unknown): boolean => a === b || lt(a, b);

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

type ValuePredicate = (rawValue: unknown) => boolean;

/**
 * Compile the row-independent half of a simple condition once: the right-hand
 * operand is coerced once, and LIKE patterns are translated to RegExp once.
 * The returned predicate does only row-dependent work.
 */
const compileOperator = (
  operator: OperatorModel,
  rawRight: unknown,
  filterType: FilterType | undefined
): ValuePredicate => {
  // IS NULL / IS NOT NULL test the raw value before any coercion.
  if (operator === "IS NULL") return isNullish;
  if (operator === "IS NOT NULL") return (rawValue) => !isNullish(rawValue);

  const right = Array.isArray(rawRight)
    ? rawRight.map((r) => coerce(r, filterType))
    : coerce(rawRight, filterType);
  const caseInsensitive = operator === "ILIKE" || operator === "NOT ILIKE";
  const like =
    typeof right === "string" &&
    (operator === "LIKE" || operator === "NOT LIKE" || caseInsensitive)
      ? likeToRegExp(right, caseInsensitive)
      : null;

  return (rawValue) => {
    // SQL three-valued logic: NULL compared with anything is NULL, which a
    // WHERE clause drops — negative operators (!=, NOT IN, NOT LIKE) included.
    if (isNullish(rawValue)) return false;

    const value = coerce(rawValue, filterType);

    switch (operator) {
      case "=":
        return value === right;
      case "!=":
        return value !== right;
      case "<":
        return lt(value, right);
      case "<=":
        return lte(value, right);
      case ">":
        return lt(right, value);
      case ">=":
        return lte(right, value);
      case "IN":
        return Array.isArray(right) && right.includes(value);
      case "NOT IN":
        return Array.isArray(right) && !right.includes(value);
      case "LIKE":
      case "ILIKE":
        return like?.test(String(value)) ?? false;
      case "NOT LIKE":
      case "NOT ILIKE":
        return !(like?.test(String(value)) ?? false);
      // Positive comparisons, not `!lt && !lt` — `lt` returns false for
      // non-comparable pairs (NaN, mixed types), which would match vacuously.
      case "BETWEEN":
        return (
          Array.isArray(right) &&
          right.length === 2 &&
          lte(right[0], value) &&
          lte(value, right[1])
        );
      case "NOT BETWEEN":
        return !(
          Array.isArray(right) &&
          right.length === 2 &&
          lte(right[0], value) &&
          lte(value, right[1])
        );
      default:
        return true;
    }
  };
};

/**
 * Compile a condition tree into a row predicate. Filter metadata and constant
 * operands are resolved once per condition rather than once per row.
 */
export function compileCondition<TRow>(
  condition: Condition,
  getValue: ValueAccessor<TRow>,
  getFilterType?: FilterTypeAccessor
): (row: TRow) => boolean {
  if (condition.compound) {
    switch (condition.operator) {
      case "AND": {
        const left = compileCondition(condition.left, getValue, getFilterType);
        const right = condition.right
          ? compileCondition(condition.right, getValue, getFilterType)
          : undefined;
        return (row) => left(row) && (right?.(row) ?? true);
      }
      case "OR": {
        const left = compileCondition(condition.left, getValue, getFilterType);
        const right = condition.right
          ? compileCondition(condition.right, getValue, getFilterType)
          : undefined;
        return (row) => left(row) || (right?.(row) ?? false);
      }
      case "NOT": {
        const left = compileCondition(condition.left, getValue, getFilterType);
        return (row) => !left(row);
      }
      default:
        return () => true;
    }
  }

  const test = compileOperator(
    condition.operator,
    condition.right,
    getFilterType?.(condition.left)
  );
  return (row) => test(getValue(row, condition.left));
}

// Default (string-ish) compare: missing values sort as smallest — first
// ascending, last descending — matching the AG-default comparator the
// pre-TanStack log list used for columns without a custom comparator.
const defaultCompare: ValueComparator = (a, b) => {
  const am = isNullish(a) || a === "";
  const bm = isNullish(b) || b === "";
  if (am && bm) return 0;
  if (am) return -1;
  if (bm) return 1;
  if (lt(a, b)) return -1;
  if (lt(b, a)) return 1;
  return 0;
};

/**
 * Build a row comparator from an `OrderBy` list. Emulates AG Grid's model:
 * call the per-column comparator with `isDescending`, then reverse its result
 * for descending — so a comparator can use `isDescending` to pin missing
 * values to one end regardless of direction (as the samples grid does; the
 * log list's own comparators sort missing as smallest and ignore it).
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
