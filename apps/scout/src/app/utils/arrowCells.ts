import type { ColumnTable } from "arquero";

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

/** Every value in a column, with non-string cells dropped. */
export const stringColumn = (table: ColumnTable, column: string): string[] => {
  const values: ArrayLike<unknown> = table.array(column);
  return Array.from(values).filter((v): v is string => typeof v === "string");
};

// Arquero builds filter(), derive() and objects() with `Function`, which a
// CSP without 'unsafe-eval' blocks, so Scout reads tables through these.

/** Every row as a column->value record. */
export const rowRecords = (table: ColumnTable): Record<string, unknown>[] => {
  const columns = table
    .columnNames()
    .map((name): [string, ArrayLike<unknown>] => [name, table.array(name)]);
  // Copying a record that already has every key keeps V8's stores in place;
  // adding the keys one at a time is ~3x slower on wide tables.
  const template: Record<string, unknown> = Object.fromEntries(
    columns.map(([name]) => [name, undefined])
  );
  const records: Record<string, unknown>[] = [];
  for (let row = 0; row < table.numRows(); row++) {
    const record = { ...template };
    for (const [name, cells] of columns) {
      record[name] = cells[row];
    }
    records.push(record);
  }
  return records;
};

/**
 * Data indices of the rows whose `column` cell satisfies `test`, and of the
 * rest, each in table order, from one scan.
 */
export const partitionRowIndices = (
  table: ColumnTable,
  column: string,
  test: (cell: unknown) => boolean
): { matching: number[]; rest: number[] } => {
  const cells = table.column(column);
  if (!cells) {
    throw new Error(`No column "${column}" to partition on`);
  }
  const matching: number[] = [];
  const rest: number[] = [];
  table.scan((row) => {
    if (row !== undefined) {
      (test(cells.at(row)) ? matching : rest).push(row);
    }
  }, true);
  return { matching, rest };
};

/**
 * Data indices (what `reify` and `column().at` take) of the rows whose
 * `column` cell satisfies `keep`, in table order.
 */
export const rowIndicesWhere = (
  table: ColumnTable,
  column: string,
  keep: (cell: unknown) => boolean
): number[] => {
  const cells = table.column(column);
  if (!cells) {
    throw new Error(`No column "${column}" to filter on`);
  }
  const indices: number[] = [];
  table.scan((row) => {
    if (row !== undefined && keep(cells.at(row))) {
      indices.push(row);
    }
  }, true);
  return indices;
};

/** The rows whose `column` cell satisfies `keep`, with every column. */
export const rowsWhere = (
  table: ColumnTable,
  column: string,
  keep: (cell: unknown) => boolean
): ColumnTable => table.reify(rowIndicesWhere(table, column, keep));
