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

/** Slice one page (with its continuation cursor) off filtered+sorted rows. */
export const pageRows = <TRow>(
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
