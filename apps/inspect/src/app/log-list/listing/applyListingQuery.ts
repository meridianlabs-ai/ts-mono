import { pageRows } from "../../../client/database/listing";

import { createListingPlan } from "./planner";
import type { ListingQuery, LogsListingResult } from "./types";

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
  let a = base[i];
  let b = overlay[j];
  while (a !== undefined && b !== undefined) {
    if (compare(a, b) <= 0) {
      merged.push(a);
      a = base[++i];
    } else {
      merged.push(b);
      b = overlay[++j];
    }
  }
  return merged.concat(base.slice(i), overlay.slice(j));
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
  return { ...pageRows(result, plan.pagination), total_count };
}
