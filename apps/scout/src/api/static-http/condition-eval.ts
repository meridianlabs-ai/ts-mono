import type { Condition, OrderByModel, ScalarValue } from "../../query";
import { isCompoundCondition, isTuple } from "../../query";
import type { Pagination } from "../../types/api-types";

/**
 * Resolve a condition column against a row. Falls back to dotted-path
 * traversal (`metadata.foo`) and then to the row's `metadata` object, since
 * the server exposes custom metadata fields as top-level filter columns.
 */
export const resolveCell = (
  row: Record<string, unknown>,
  column: string
): unknown => {
  if (column in row) return row[column];

  if (column.includes(".")) {
    let value: unknown = row;
    for (const part of column.split(".")) {
      if (value === null || typeof value !== "object") return undefined;
      value = (value as Record<string, unknown>)[part];
    }
    return value;
  }

  const metadata = row["metadata"];
  if (metadata && typeof metadata === "object") {
    return (metadata as Record<string, unknown>)[column];
  }
  return undefined;
};

/**
 * SQL three-valued truth: `null` is "unknown". Comparisons with a NULL
 * operand are unknown (so the row is excluded), and unknown propagates
 * through AND/OR/NOT per Kleene logic — matching how the server evaluates
 * the same Condition in SQL.
 */
type Truth = boolean | null;

/** Apply a Condition to a single row, returning whether it passes. */
export const evaluateCondition = (
  row: Record<string, unknown>,
  condition: Condition
): boolean => evaluateTruth(row, condition) === true;

const evaluateTruth = (
  row: Record<string, unknown>,
  condition: Condition
): Truth => {
  if (isCompoundCondition(condition)) {
    const left = evaluateTruth(row, condition.left);
    if (condition.operator === "NOT") {
      return left === null ? null : !left;
    }
    if (condition.right === null) return left;
    const right = evaluateTruth(row, condition.right);
    if (condition.operator === "AND") {
      if (left === false || right === false) return false;
      return left === null || right === null ? null : true;
    }
    // OR
    if (left === true || right === true) return true;
    return left === null || right === null ? null : false;
  }

  const cell = resolveCell(row, condition.left);
  const target = condition.right;

  switch (condition.operator) {
    case "IS NULL":
      return cell === null || cell === undefined;
    case "IS NOT NULL":
      return cell !== null && cell !== undefined;
    default:
      break;
  }

  // Every remaining operator is a comparison: a NULL cell makes it unknown.
  if (cell === null || cell === undefined) return null;

  switch (condition.operator) {
    case "=":
      return target === null ? null : cell === target;
    case "!=":
      return target === null ? null : cell !== target;
    case "<":
      return target === null ? null : scalarCompare(cell, target) < 0;
    case "<=":
      return target === null ? null : scalarCompare(cell, target) <= 0;
    case ">":
      return target === null ? null : scalarCompare(cell, target) > 0;
    case ">=":
      return target === null ? null : scalarCompare(cell, target) >= 0;
    // Branch on the operator, not isScalarArray: isTuple claims any
    // 2-element array, which would misclassify a 2-value IN list.
    case "IN":
      return inList(cell, target);
    case "NOT IN":
      return notTruth(inList(cell, target));
    case "LIKE":
      return likeMatch(cell, target, false);
    case "NOT LIKE":
      return notTruth(likeMatch(cell, target, false));
    case "ILIKE":
      return likeMatch(cell, target, true);
    case "NOT ILIKE":
      return notTruth(likeMatch(cell, target, true));
    case "BETWEEN":
      return between(cell, target);
    case "NOT BETWEEN":
      return notTruth(between(cell, target));
    default:
      return false;
  }
};

const notTruth = (t: Truth): Truth => (t === null ? null : !t);

/** SQL IN: true on a match, unknown if no match but the list has NULLs. */
const inList = (cell: unknown, target: unknown): Truth => {
  if (!Array.isArray(target)) return false;
  if (target.some((v) => v !== null && cell === v)) return true;
  return target.includes(null) ? null : false;
};

const between = (cell: unknown, target: unknown): Truth => {
  if (!isTuple(target)) return false;
  if (target[0] === null || target[1] === null) return null;
  return (
    scalarCompare(cell, target[0]) >= 0 && scalarCompare(cell, target[1]) <= 0
  );
};

const comparableString = (v: unknown): string => {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint")
    return v.toString();
  return JSON.stringify(v) ?? "";
};

/** SQL-ish ordering: nulls sort first, numbers numerically, rest as strings. */
export const scalarCompare = (a: unknown, b: unknown): number => {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return comparableString(a) < comparableString(b) ? -1 : 1;
};

// Compiled LIKE patterns are cached: the full-load path evaluates the same
// condition against ~100k rows, and compiling a RegExp per row is wasteful.
const likeRegexCache = new Map<string, RegExp>();

const likeRegex = (pattern: string, caseInsensitive: boolean): RegExp => {
  const key = (caseInsensitive ? "i:" : ":") + pattern;
  let re = likeRegexCache.get(key);
  if (!re) {
    re = new RegExp(
      "^" +
        pattern
          .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
          .replace(/%/g, ".*")
          .replace(/_/g, ".") +
        "$",
      caseInsensitive ? "i" : ""
    );
    if (likeRegexCache.size >= 500) likeRegexCache.clear();
    likeRegexCache.set(key, re);
  }
  return re;
};

const likeMatch = (
  cell: unknown,
  pattern: unknown,
  caseInsensitive: boolean
): Truth => {
  if (pattern === null) return null;
  if (typeof cell !== "string" || typeof pattern !== "string") return false;
  return likeRegex(pattern, caseInsensitive).test(cell);
};

/** Stable, multi-column sort matching SQL semantics. */
export const applyOrderBy = <T extends Record<string, unknown>>(
  rows: readonly T[],
  orderBy: OrderByModel | OrderByModel[] | undefined
): T[] => {
  if (!orderBy) return [...rows];
  const orderColumns = Array.isArray(orderBy) ? orderBy : [orderBy];
  if (orderColumns.length === 0) return [...rows];
  return [...rows].sort((a, b) => {
    for (const ob of orderColumns) {
      const cmp = scalarCompare(
        resolveCell(a, ob.column),
        resolveCell(b, ob.column)
      );
      if (cmp !== 0) return ob.direction === "DESC" ? -cmp : cmp;
    }
    return 0;
  });
};

/** Apply cursor-based pagination matching the server's interpretation. */
export const applyPagination = <T extends Record<string, unknown>>(
  rows: readonly T[],
  orderBy: OrderByModel | OrderByModel[] | undefined,
  pagination: Pagination | undefined,
  idColumn: string
): { items: T[]; nextCursor: Record<string, ScalarValue> | null } => {
  if (!pagination) return { items: [...rows], nextCursor: null };

  const orderColumns = orderBy
    ? Array.isArray(orderBy)
      ? orderBy
      : [orderBy]
    : [];
  // Server always appends a stable tiebreaker on the id column for cursoring.
  const sortColumns: OrderByModel[] = [
    ...orderColumns,
    { column: idColumn, direction: "ASC" },
  ];

  let filtered: T[] = [...rows];
  if (pagination.cursor) {
    filtered = filtered.filter((row) =>
      cursorIncludes(row, pagination.cursor!, sortColumns, pagination.direction)
    );
  }

  const sorted = applyOrderBy(filtered, sortColumns);
  if (pagination.direction === "backward") {
    sorted.reverse();
  }

  const window = sorted.slice(0, pagination.limit);

  let nextCursor: Record<string, ScalarValue> | null = null;
  if (window.length === pagination.limit && window.length > 0) {
    const edge: T =
      pagination.direction === "forward"
        ? window[window.length - 1]!
        : window[0]!;
    nextCursor = Object.fromEntries(
      sortColumns.map((c) => [
        c.column,
        resolveCell(edge, c.column) as ScalarValue,
      ])
    );
  }

  // For backward pagination the server returns rows in original (forward)
  // order, so flip back.
  if (pagination.direction === "backward") {
    window.reverse();
  }

  return { items: window, nextCursor };
};

/**
 * Decide whether a row is on the correct side of the cursor given the sort
 * columns and pagination direction. Used to skip already-seen rows.
 */
export const cursorIncludes = (
  row: Record<string, unknown>,
  cursor: { [key: string]: unknown },
  sortColumns: OrderByModel[],
  direction: "forward" | "backward"
): boolean => {
  for (const ob of sortColumns) {
    const cell = resolveCell(row, ob.column);
    const cursorVal = cursor[ob.column];
    const cmp = scalarCompare(cell, cursorVal);
    if (cmp === 0) continue;
    // Forward + ASC: include rows strictly greater than cursor.
    // Backward + ASC: include rows strictly less than cursor.
    const effective = ob.direction === "DESC" ? -cmp : cmp;
    return direction === "forward" ? effective > 0 : effective < 0;
  }
  return false;
};
