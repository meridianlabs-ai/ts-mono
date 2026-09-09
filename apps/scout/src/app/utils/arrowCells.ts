import { ColumnTable } from "arquero";

import { isRecord } from "@tsmono/util";

/**
 * Checked readers for arquero cells. Arquero types every cell as `DataValue`
 * (`any`), so reading one is a boundary: these are the only place scout claims
 * what a scan-dataframe column holds, and they test the claim instead of
 * asserting it. A cell whose runtime type doesn't match reads as absent — the
 * same shape the old `as` produced for a null cell, without the lie.
 */

const cell = (table: ColumnTable, column: string, row: number): unknown =>
  table.columnNames().includes(column) ? table.get(column, row) : undefined;

export const stringCell = (
  table: ColumnTable,
  column: string,
  row = 0
): string => optionalStringCell(table, column, row) ?? "";

export const optionalStringCell = (
  table: ColumnTable,
  column: string,
  row = 0
): string | undefined => {
  const value = cell(table, column, row);
  return typeof value === "string" ? value : undefined;
};

export const optionalNumberCell = (
  table: ColumnTable,
  column: string,
  row = 0
): number | undefined => {
  const value = cell(table, column, row);
  return typeof value === "number" ? value : undefined;
};

export const optionalBooleanCell = (
  table: ColumnTable,
  column: string,
  row = 0
): boolean | undefined => {
  const value = cell(table, column, row);
  return typeof value === "boolean" ? value : undefined;
};

/** transcript_task_id is written as either a string or an integer. */
export const optionalIdCell = (
  table: ColumnTable,
  column: string,
  row = 0
): string | number | undefined => {
  const value = cell(table, column, row);
  return typeof value === "string" || typeof value === "number"
    ? value
    : undefined;
};

/** The raw cell, for columns whose value is normalized elsewhere. */
export const rawCell = cell;

/**
 * `params(values)` returns the table; the `Params` half of its return type is
 * the no-argument getter form, which narrowing discards.
 */
export const withParams = (
  table: ColumnTable,
  values: Record<string, unknown>
): ColumnTable => {
  const scoped = table.params(values);
  if (!(scoped instanceof ColumnTable)) {
    throw new Error("arquero params() did not return the table");
  }
  return scoped;
};

/** Every value in a column, with non-string cells dropped. */
export const stringColumn = (table: ColumnTable, column: string): string[] => {
  const values: ArrayLike<unknown> = table.array(column);
  return Array.from(values).filter((v): v is string => typeof v === "string");
};

/**
 * `objects()` is typed `object[]`; every row is a column->value record.
 * Filtering rather than asserting drops nothing in practice and keeps the
 * index signature honest.
 */
export const rowRecords = (table: ColumnTable): Record<string, unknown>[] =>
  table.objects().filter(isRecord);
