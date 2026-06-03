import type { Condition, OrderByModel, ScalarValue } from "../../query";
import { isCompoundCondition, isScalarArray, isTuple } from "../../query/types";
import type { Pagination } from "../../types/api-types";

export type SqlParam = ScalarValue;

export interface SqlFragment {
  sql: string;
  params: SqlParam[];
}

export interface ListingSql {
  where: SqlFragment | null;
  countWhere: SqlFragment | null;
  orderBy: string;
  limit: string;
  needsReverse: boolean;
  orderColumns: OrderByModel[];
}

export const conditionToSql = (condition: Condition): SqlFragment => {
  if (isCompoundCondition(condition)) {
    if (condition.operator === "NOT") {
      return unarySql("NOT", conditionToSql(condition.left));
    }

    const right = condition.right;
    if (right === null) {
      return conditionToSql(condition.left);
    }

    return binarySql(
      condition.operator,
      conditionToSql(condition.left),
      conditionToSql(right)
    );
  }

  const column = quoteIdentifier(condition.left);
  const value = condition.right;

  switch (condition.operator) {
    case "IS NULL":
      return { sql: `${column} IS NULL`, params: [] };
    case "IS NOT NULL":
      return { sql: `${column} IS NOT NULL`, params: [] };
    case "=":
    case "!=":
    case "<":
    case "<=":
    case ">":
    case ">=":
    case "LIKE":
    case "NOT LIKE":
    case "ILIKE":
    case "NOT ILIKE":
      return {
        sql: `${column} ${condition.operator} ?`,
        params: [scalar(value)],
      };
    case "IN":
      return inSql(column, value, false);
    case "NOT IN":
      return inSql(column, value, true);
    case "BETWEEN":
      return betweenSql(column, value, false);
    case "NOT BETWEEN":
      return betweenSql(column, value, true);
  }
};

export const buildListingSql = (
  filter: Condition | undefined,
  orderBy: OrderByModel | OrderByModel[] | undefined,
  pagination: Pagination | undefined,
  idColumn: string
): ListingSql => {
  const countWhere = filter ? conditionToSql(filter) : null;
  const conditions: SqlFragment[] = countWhere ? [countWhere] : [];
  let orderColumns: OrderByModel[] = [];
  let dbOrderColumns: OrderByModel[] = [];
  let limit = "";
  let needsReverse = false;

  if (pagination) {
    orderColumns = ensureTiebreaker(
      orderBy ?? { column: idColumn, direction: "ASC" },
      idColumn
    );
    dbOrderColumns = orderColumns;

    if (pagination.direction === "backward" && !pagination.cursor) {
      dbOrderColumns = reverseOrderColumns(orderColumns);
      needsReverse = true;
    }

    if (pagination.cursor) {
      conditions.push(
        cursorToSql(pagination.cursor, orderColumns, pagination.direction)
      );
    }
    limit = " LIMIT ?";
  } else if (orderBy) {
    dbOrderColumns = normalizeOrderBy(orderBy);
  }

  const where = andSql(conditions);
  const orderClause =
    dbOrderColumns.length > 0
      ? ` ORDER BY ${dbOrderColumns
          .map((ob) => `${quoteIdentifier(ob.column)} ${ob.direction}`)
          .join(", ")}`
      : "";

  return {
    where,
    countWhere,
    orderBy: orderClause,
    limit,
    needsReverse,
    orderColumns,
  };
};

export const limitParams = (pagination: Pagination | undefined): SqlParam[] =>
  pagination ? [pagination.limit] : [];

export const quoteIdentifier = (identifier: string): string =>
  `"${identifier.replace(/"/g, '""')}"`;

export const quoteLiteral = (literal: string): string =>
  `'${literal.replace(/'/g, "''")}'`;

const scalar = (value: unknown): SqlParam => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  throw new Error(`Expected scalar SQL parameter, received ${typeof value}`);
};

const inSql = (
  column: string,
  value: unknown,
  negated: boolean
): SqlFragment => {
  if (!isScalarArray(value)) {
    throw new Error("IN operator requires an array value");
  }

  // SQL NULL never matches inside an IN list, so split nulls into an explicit
  // IS NULL / IS NOT NULL term (mirrors the Python condition_sql implementation).
  const vals = value.filter((v) => v !== null);
  const hasNull = vals.length !== value.length;

  if (vals.length === 0 && !hasNull) {
    return { sql: negated ? "TRUE" : "FALSE", params: [] };
  }

  const parts: string[] = [];
  if (vals.length > 0) {
    const placeholders = vals.map(() => "?").join(", ");
    parts.push(`${column} ${negated ? "NOT IN" : "IN"} (${placeholders})`);
  }
  if (hasNull) {
    parts.push(`${column} IS ${negated ? "NOT NULL" : "NULL"}`);
  }

  const sql = parts.join(negated ? " AND " : " OR ");
  return {
    sql: parts.length > 1 ? `(${sql})` : sql,
    params: vals,
  };
};

const betweenSql = (
  column: string,
  value: unknown,
  negated: boolean
): SqlFragment => {
  if (!isTuple(value)) {
    throw new Error("BETWEEN operator requires a two-value tuple");
  }
  return {
    sql: `${column} ${negated ? "NOT BETWEEN" : "BETWEEN"} ? AND ?`,
    params: [value[0], value[1]],
  };
};

const unarySql = (operator: string, child: SqlFragment): SqlFragment => ({
  sql: `${operator} (${child.sql})`,
  params: child.params,
});

const binarySql = (
  operator: "AND" | "OR",
  left: SqlFragment,
  right: SqlFragment
): SqlFragment => ({
  sql: `(${left.sql}) ${operator} (${right.sql})`,
  params: [...left.params, ...right.params],
});

const andSql = (conditions: SqlFragment[]): SqlFragment | null => {
  if (conditions.length === 0) return null;
  return conditions.reduce((left, right) => binarySql("AND", left, right));
};

const orSql = (conditions: SqlFragment[]): SqlFragment => {
  if (conditions.length === 0) {
    return { sql: "FALSE", params: [] };
  }
  return conditions.reduce((left, right) => binarySql("OR", left, right));
};

const normalizeOrderBy = (
  orderBy: OrderByModel | OrderByModel[]
): OrderByModel[] => (Array.isArray(orderBy) ? orderBy : [orderBy]);

const ensureTiebreaker = (
  orderBy: OrderByModel | OrderByModel[],
  idColumn: string
): OrderByModel[] => {
  const columns = normalizeOrderBy(orderBy);
  return columns.some((ob) => ob.column === idColumn)
    ? columns
    : [...columns, { column: idColumn, direction: "ASC" }];
};

const reverseOrderColumns = (orderColumns: OrderByModel[]): OrderByModel[] =>
  orderColumns.map((ob) => ({
    column: ob.column,
    direction: ob.direction === "ASC" ? "DESC" : "ASC",
  }));

const cursorToSql = (
  cursor: { [key: string]: unknown },
  orderColumns: OrderByModel[],
  direction: "forward" | "backward"
): SqlFragment => {
  const orConditions = orderColumns.map((ob, index) => {
    const equalities = orderColumns.slice(0, index).map((prefix) => ({
      sql: `${quoteIdentifier(prefix.column)} = ?`,
      params: [scalar(cursor[prefix.column])],
    }));
    const operator = cursorOperator(ob.direction, direction);
    return andSql([
      ...equalities,
      {
        sql: `${quoteIdentifier(ob.column)} ${operator} ?`,
        params: [scalar(cursor[ob.column])],
      },
    ]);
  });

  return orSql(orConditions.filter((condition) => condition !== null));
};

const cursorOperator = (
  sortDirection: "ASC" | "DESC",
  pageDirection: "forward" | "backward"
): ">" | "<" => {
  const wantGreater =
    (pageDirection === "forward" && sortDirection === "ASC") ||
    (pageDirection === "backward" && sortDirection === "DESC");
  return wantGreater ? ">" : "<";
};
