import type { Collection } from "dexie";

import type { Pagination } from "@tsmono/inspect-common/query";

export interface DatabaseListingPlan<TRow> {
  matches: (row: TRow) => boolean;
  compare?: (a: TRow, b: TRow) => number;
  pagination?: Pagination;
}

export interface DatabaseListingResult<TRow> {
  items: TRow[];
  total_count: number;
  next_cursor: { offset: number; [key: string]: unknown } | null;
}

const pageRows = <TRow>(
  rows: TRow[],
  pagination?: Pagination
): Pick<DatabaseListingResult<TRow>, "items" | "next_cursor"> => {
  if (!pagination) return { items: rows, next_cursor: null };
  const offset =
    pagination.cursor && typeof pagination.cursor.offset === "number"
      ? pagination.cursor.offset
      : 0;
  const end = offset + pagination.limit;
  return {
    items: rows.slice(offset, end),
    next_cursor: end < rows.length ? { offset: end } : null,
  };
};

/** Execute a listing plan while the scoped Dexie cursor is active. */
export const queryDexieCollection = async <TRecord, TKey, TRow>(
  collection: Collection<TRecord, TKey>,
  toRow: (record: TRecord) => TRow | undefined,
  plan: DatabaseListingPlan<TRow>
): Promise<DatabaseListingResult<TRow>> => {
  const records = await collection
    .filter((record) => {
      const row = toRow(record);
      return row !== undefined && plan.matches(row);
    })
    .toArray();
  const rows = records
    .map(toRow)
    .filter((row): row is TRow => row !== undefined);

  if (plan.compare) rows.sort(plan.compare);

  const total_count = rows.length;
  return { ...pageRows(rows, plan.pagination), total_count };
};
