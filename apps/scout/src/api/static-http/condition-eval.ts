import type { Condition, OrderByModel, ScalarValue } from "../../query";
import { isCompoundCondition, isScalarArray, isTuple } from "../../query/types";
import type { Pagination } from "../../types/api-types";

/** Apply a Condition to a single row, returning whether it passes. */
export const evaluateCondition = (
  row: Record<string, unknown>,
  condition: Condition
): boolean => {
  if (isCompoundCondition(condition)) {
    if (condition.operator === "NOT") {
      return !evaluateCondition(row, condition.left);
    }
    const leftResult = evaluateCondition(row, condition.left);
    const right = condition.right;
    if (right === null) return leftResult;
    if (condition.operator === "AND") {
      return leftResult && evaluateCondition(row, right);
    }
    // OR
    return leftResult || evaluateCondition(row, right);
  }

  const cell = row[condition.left];
  const target = condition.right;

  switch (condition.operator) {
    case "IS NULL":
      return cell === null || cell === undefined;
    case "IS NOT NULL":
      return cell !== null && cell !== undefined;
    case "=":
      return cellEquals(cell, target);
    case "!=":
      return !cellEquals(cell, target);
    case "<":
      return scalarCompare(cell, target) < 0;
    case "<=":
      return scalarCompare(cell, target) <= 0;
    case ">":
      return scalarCompare(cell, target) > 0;
    case ">=":
      return scalarCompare(cell, target) >= 0;
    case "IN":
      return isScalarArray(target) && target.some((v) => cellEquals(cell, v));
    case "NOT IN":
      return isScalarArray(target) && !target.some((v) => cellEquals(cell, v));
    case "LIKE":
      return likeMatch(cell, target, false);
    case "NOT LIKE":
      return !likeMatch(cell, target, false);
    case "ILIKE":
      return likeMatch(cell, target, true);
    case "NOT ILIKE":
      return !likeMatch(cell, target, true);
    case "BETWEEN":
      return (
        isTuple(target) &&
        scalarCompare(cell, target[0]) >= 0 &&
        scalarCompare(cell, target[1]) <= 0
      );
    case "NOT BETWEEN":
      return (
        isTuple(target) &&
        (scalarCompare(cell, target[0]) < 0 ||
          scalarCompare(cell, target[1]) > 0)
      );
    default:
      return false;
  }
};

const cellEquals = (cell: unknown, target: unknown): boolean => {
  if (cell === target) return true;
  if (cell === null || target === null) return false;
  if (cell === undefined || target === undefined) return false;
  return cell === target;
};

const scalarCompare = (a: unknown, b: unknown): number => {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a) < String(b) ? -1 : 1;
};

const likeMatch = (
  cell: unknown,
  pattern: unknown,
  caseInsensitive: boolean
): boolean => {
  if (typeof cell !== "string" || typeof pattern !== "string") return false;
  const re = new RegExp(
    "^" +
      pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/%/g, ".*")
        .replace(/_/g, ".") +
      "$",
    caseInsensitive ? "i" : ""
  );
  return re.test(cell);
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
      const cmp = scalarCompare(a[ob.column], b[ob.column]);
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
      sortColumns.map((c) => [c.column, edge[c.column] as ScalarValue])
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
const cursorIncludes = (
  row: Record<string, unknown>,
  cursor: { [key: string]: unknown },
  sortColumns: OrderByModel[],
  direction: "forward" | "backward"
): boolean => {
  for (const ob of sortColumns) {
    const cell = row[ob.column];
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
