import type { Pagination } from "@tsmono/inspect-common/query";

import { createListingPlan } from "./planner";
import type { Cursor, ListingQuery, LogsListingResult } from "./types";

const paginate = <TRow>(
  rows: TRow[],
  pagination?: Pagination
): { page: TRow[]; next_cursor: Cursor | null } => {
  if (!pagination) return { page: rows, next_cursor: null };
  // Forward-only for now; `direction: "backward"` is unused client-side.
  const offset =
    pagination.cursor && typeof pagination.cursor.offset === "number"
      ? pagination.cursor.offset
      : 0;
  const end = offset + pagination.limit;
  return {
    page: rows.slice(offset, end),
    next_cursor: end < rows.length ? { offset: end } : null,
  };
};

/**
 * Merge two individually-sorted row lists into one sorted list; ties place
 * `base` rows first. Without a comparator the overlay is appended (the
 * unsorted listing shows transient rows after files). This is how transient
 * rows (e.g. pending tasks, which have no database record) join a
 * database-produced page without forcing the whole listing back into memory.
 */
export function mergeSortedRows<TRow>(
  base: TRow[],
  overlay: TRow[],
  compare?: (a: TRow, b: TRow) => number
): TRow[] {
  if (overlay.length === 0) return base;
  if (!compare || base.length === 0) return [...base, ...overlay];
  const merged: TRow[] = [];
  let i = 0;
  let j = 0;
  while (i < base.length && j < overlay.length) {
    merged.push(
      compare(base[i]!, overlay[j]!) <= 0 ? base[i++]! : overlay[j++]!
    );
  }
  while (i < base.length) merged.push(base[i++]!);
  while (j < overlay.length) merged.push(overlay[j++]!);
  return merged;
}

/**
 * TRANSITIONAL client-side stand-in for a server `getLogsListing(dir, filter,
 * orderBy, pagination)`. Filters → sorts → paginates the in-memory rows and
 * returns a scout-shaped result. When inspect goes server-side this is replaced
 * by an API fetch; the react-query boundary above it stays.
 */
export function applyListingQuery<TRow>(
  rows: TRow[],
  query: ListingQuery<TRow>
): LogsListingResult<TRow> {
  const plan = createListingPlan(query);
  let result = rows.filter(plan.matches);
  if (plan.compare) result = [...result].sort(plan.compare);

  const total_count = result.length;
  const { page, next_cursor } = paginate(result, plan.pagination);
  return { items: page, total_count, next_cursor };
}
