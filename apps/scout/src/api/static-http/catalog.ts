import type { Condition, OrderByModel, ScalarValue } from "../../query";
import type { Pagination } from "../../types/api-types";

import type {
  CatalogManifest,
  ColumnValuesFile,
  ShardEntry,
} from "./bundle-format";
import {
  applyOrderBy,
  applyPagination,
  cursorIncludes,
  evaluateCondition,
  scalarCompare,
} from "./condition-eval";
import { fetchJson, fetchJsonZst, joinUrl } from "./fetch";

type Row = Record<string, unknown>;

export interface ListingResult {
  items: Row[];
  total_count: number;
  next_cursor: Record<string, ScalarValue> | null;
}

const normalizeOrderBy = (
  orderBy: OrderByModel | OrderByModel[] | undefined
): OrderByModel[] =>
  orderBy ? (Array.isArray(orderBy) ? orderBy : [orderBy]) : [];

/**
 * A sharded catalog listing backed by `.json.zst` shard files.
 *
 * Rows load lazily and cache in memory: arbitrary filters/sorts trigger a
 * one-time parallel load of all shards, while the default listing view
 * (no filter, sorted by the manifest's default_order column) fetches only
 * the shards whose min/max range overlaps the requested page.
 */
export class StaticCatalog {
  private readonly shardRows = new Map<string, Promise<Row[]>>();
  private allRowsPromise: Promise<Row[]> | undefined;
  private columnValuesPromise: Promise<ColumnValuesFile> | undefined;

  constructor(
    private readonly baseUrl: string,
    private readonly manifest: CatalogManifest
  ) {}

  get idColumn(): string {
    return this.manifest.id_column;
  }

  async query(
    filter: Condition | undefined,
    orderBy: OrderByModel | OrderByModel[] | undefined,
    pagination: Pagination | undefined
  ): Promise<ListingResult> {
    const orderColumns = normalizeOrderBy(orderBy);

    if (!filter && pagination && this.canShardSkip(orderColumns)) {
      return this.queryDefaultOrder(orderColumns[0]!, pagination);
    }

    const rows = await this.loadAll();
    const filtered = filter
      ? rows.filter((row) => evaluateCondition(row, filter))
      : rows;
    const ordered = applyOrderBy(filtered, orderColumns);
    const { items, nextCursor } = applyPagination(
      ordered,
      orderColumns,
      pagination,
      this.manifest.id_column
    );
    return {
      items,
      total_count: filtered.length,
      next_cursor: nextCursor,
    };
  }

  async distinct(
    column: string,
    filter: Condition | undefined
  ): Promise<ScalarValue[]> {
    if (!filter && this.manifest.column_values) {
      const values = await this.loadColumnValues();
      const precomputed = values[column];
      if (precomputed) return precomputed;
    }
    const rows = await this.loadAll();
    const filtered = filter
      ? rows.filter((row) => evaluateCondition(row, filter))
      : rows;
    return collectDistinct(filtered, column);
  }

  async hasRow(id: string): Promise<boolean> {
    const rows = await this.loadAll();
    return rows.some((row) => row[this.manifest.id_column] === id);
  }

  // Cached promises are evicted on rejection so a transient fetch failure
  // doesn't poison the cache — react-query retries then get a fresh attempt.

  private loadShard(entry: ShardEntry): Promise<Row[]> {
    let promise = this.shardRows.get(entry.path);
    if (!promise) {
      promise = fetchJsonZst<Row[]>(joinUrl(this.baseUrl, entry.path)).catch(
        (err: unknown) => {
          this.shardRows.delete(entry.path);
          throw err;
        }
      );
      this.shardRows.set(entry.path, promise);
    }
    return promise;
  }

  private loadAll(): Promise<Row[]> {
    if (!this.allRowsPromise) {
      this.allRowsPromise = Promise.all(
        this.manifest.shards.map((s) => this.loadShard(s))
      )
        .then((chunks) => chunks.flat())
        .catch((err: unknown) => {
          this.allRowsPromise = undefined;
          throw err;
        });
    }
    return this.allRowsPromise;
  }

  private loadColumnValues(): Promise<ColumnValuesFile> {
    if (!this.columnValuesPromise) {
      this.columnValuesPromise = fetchJson<ColumnValuesFile>(
        joinUrl(this.baseUrl, this.manifest.column_values!)
      ).catch((err: unknown) => {
        this.columnValuesPromise = undefined;
        throw err;
      });
    }
    return this.columnValuesPromise;
  }

  /**
   * The shard-skip fast path applies only to pages of the default ordering:
   * a single orderBy on the manifest's default_order column, no filter, and
   * shard stats present.
   */
  private canShardSkip(orderColumns: OrderByModel[]): boolean {
    return (
      orderColumns.length === 1 &&
      orderColumns[0]!.column === this.manifest.default_order.column &&
      this.manifest.shards.length > 0 &&
      this.manifest.shards.every(
        (s) => s.min !== undefined && s.max !== undefined
      )
    );
  }

  /**
   * Serve one page by loading shards in traversal order until the window is
   * full. Shards are written globally sorted ascending by the stat column,
   * so once `limit` qualifying rows are collected, later shards can only
   * contribute on boundary ties (equal stat value, id tiebreak) — detected
   * by comparing the next shard's leading edge against the window edge.
   */
  private async queryDefaultOrder(
    orderBy: OrderByModel,
    pagination: Pagination
  ): Promise<ListingResult> {
    const column = orderBy.column;
    const idColumn = this.manifest.id_column;
    const sortColumns: OrderByModel[] = [
      orderBy,
      { column: idColumn, direction: "ASC" },
    ];

    // Traversal over the ASC-sorted shard list: requested DESC reads from the
    // end; backward pagination flips it again.
    const reverse =
      (orderBy.direction === "DESC") !== (pagination.direction === "backward");
    const ordered = reverse
      ? [...this.manifest.shards].reverse()
      : this.manifest.shards;

    const cursor = pagination.cursor ?? undefined;
    const cursorVal = cursor?.[column];

    const collected: Row[] = [];
    for (let i = 0; i < ordered.length; i++) {
      const shard = ordered[i]!;

      // Shards entirely on the already-seen side of the cursor can't
      // contribute; boundary ties (== cursor value) are kept for the id
      // tiebreak.
      if (cursor && cursorVal !== undefined) {
        if (!reverse && scalarCompare(shard.max, cursorVal) < 0) continue;
        if (reverse && scalarCompare(shard.min, cursorVal) > 0) continue;
      }

      collected.push(...(await this.loadShard(shard)));

      const qualifying = cursor
        ? collected.filter((row) =>
            cursorIncludes(row, cursor, sortColumns, pagination.direction)
          )
        : collected;
      if (qualifying.length < pagination.limit) continue;

      const next = ordered[i + 1];
      if (!next) break;

      // Window edge value under the requested ordering: the limit-th
      // qualifying row (mirroring applyPagination's backward flip). Later
      // shards matter only if their leading edge ties with it.
      const sorted = applyOrderBy(qualifying, sortColumns);
      if (pagination.direction === "backward") sorted.reverse();
      const windowEdge = sorted.slice(0, pagination.limit).at(-1)!;
      const nextLeading = reverse ? next.max : next.min;
      if (scalarCompare(nextLeading, windowEdge[column]) !== 0) break;
    }

    const { items, nextCursor } = applyPagination(
      collected,
      orderBy,
      pagination,
      idColumn
    );
    return {
      items,
      total_count: this.manifest.row_count,
      next_cursor: nextCursor,
    };
  }
}

/** Compute distinct sorted scalar values for a column across a row collection. */
const collectDistinct = (
  rows: readonly Row[],
  column: string
): ScalarValue[] => {
  const seen = new Set<string>();
  const out: ScalarValue[] = [];
  for (const row of rows) {
    const raw = row[column];
    if (raw === undefined) continue;
    const value = raw as ScalarValue;
    const key =
      value === null ? "__null__" : `${typeof value}:${String(value)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  out.sort(scalarCompare);
  return out;
};
