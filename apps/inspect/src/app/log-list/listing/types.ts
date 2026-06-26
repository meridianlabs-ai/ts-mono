import type {
  Condition,
  OrderByModel,
  Pagination,
} from "@tsmono/inspect-common/query";

/**
 * Opaque pagination cursor for the client-side listing query. Mirrors scout's
 * cursor shape (`Pagination.cursor` is `{ [k]: unknown } | null`); we store a
 * simple offset.
 */
export interface Cursor {
  offset: number;
  // Index signature so a Cursor satisfies the generated `Pagination.cursor`
  // (`{ [key: string]: unknown } | null`).
  [key: string]: unknown;
}

/**
 * Result of a listing query — mirrors scout's `TranscriptsResponse`
 * (`{ items, total_count, next_cursor }`). Named `*Result` to avoid colliding
 * with the generated `LogListingResponse` (the existing `/logs` datapath).
 */
export interface LogsListingResult<TRow> {
  items: TRow[];
  /** Total rows after filtering, before pagination. */
  total_count: number;
  next_cursor?: Cursor | null;
}

/** Compares two raw cell values. `isDescending` matches the AG comparator
 *  contract so `gridComparators` primitives are reusable: the function sorts
 *  ascending, and the caller negates the result for descending — the flag only
 *  lets comparators pin missing values last regardless of direction. */
export type ValueComparator = (
  a: unknown,
  b: unknown,
  isDescending: boolean
) => number;

/** Reads a row's value for a column id (built from the column defs). */
export type ValueAccessor<TRow> = (row: TRow, columnId: string) => unknown;

export interface ListingQuery<TRow> {
  filter?: Condition;
  orderBy?: OrderByModel | OrderByModel[];
  pagination?: Pagination;
  getValue: ValueAccessor<TRow>;
  /** Per-column value comparator; falls back to a default compare. */
  getComparator: (columnId: string) => ValueComparator | undefined;
}
