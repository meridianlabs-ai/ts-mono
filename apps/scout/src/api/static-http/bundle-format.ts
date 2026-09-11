/**
 * Types describing the static bundle layout produced by `scout view bundle`.
 *
 * This is a cross-repo contract: the Python bundler in inspect_scout writes
 * these files; this client reads them. See docs/static-bundle-format.md for
 * the full specification. Bump `kBundleFormatVersion` in lockstep with the
 * bundler when making incompatible changes.
 */

import type { ScalarValue } from "../../query";

export const kBundleFormatName = "scout-static-bundle";
export const kBundleFormatVersion = 1;

export type OrderDirection = "ASC" | "DESC";

export interface ShardEntry {
  /** Path relative to the manifest's directory, e.g. `transcripts/catalog/shard-0000.json.zst`. */
  path: string;
  /** Number of rows in the shard. */
  row_count: number;
  /**
   * Min/max of the catalog's `default_order.column` within this shard.
   * Shards are written globally sorted ascending by that column (nulls
   * first), so these ranges only overlap at boundary ties. Null when the
   * shard contains only null values for the column.
   */
  min: ScalarValue;
  max: ScalarValue;
}

export interface CatalogManifest {
  /** Original directory URI this catalog snapshots (shown in the UI). */
  dir: string;
  /** Unique row id column: `transcript_id` for transcripts, `scan_id` for scans. */
  id_column: string;
  /** Total rows across all shards. */
  row_count: number;
  /**
   * The sort order shards are written in. The client serves pages of the
   * default listing view (and cursor pages on the same column) by fetching
   * only the shards whose min/max range overlaps the page window.
   */
  default_order: { column: string; direction: OrderDirection };
  shards: ShardEntry[];
  /**
   * Path (relative to the manifest) of a JSON file mapping column name to
   * pre-computed sorted distinct values, used for filter autocomplete
   * without a full catalog read.
   */
  column_values?: string;
}

export interface BundleManifest {
  format: typeof kBundleFormatName;
  version: number;
  generated_at?: string;
  transcripts?: CatalogManifest;
  scans?: CatalogManifest;
}

export type ColumnValuesFile = Record<string, ScalarValue[]>;
