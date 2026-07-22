/**
 * Entry naming and chunk math for the chunked per-sample log format — the TS
 * twin of inspect_ai's `log/_recorders/chunked/format.py`.
 *
 * Chunking is writer policy, not format: the central directory's entry
 * names are the only persisted record of the chunk layout. Chunk entries
 * are named by the index of their first item only; every range is
 * half-open `[start, end_exclusive)`. A chunk's extent is the next
 * chunk's start; the last chunk's end (the sequence count) is learned by
 * parsing it — for events it's also the sum of the stats sidecar's
 * per-chunk type counts.
 */
import type { SequenceName } from "./types";

const SAMPLES_DIR = "samples";
export const SHELL_JSON = "sample.json";
export const METADATA_JSON = "metadata.json";
export const SKELETON_JSON = "skeleton.json";
export const STATS_JSON = "stats.json";
export const UUIDS_JSON = "uuids.json";

/** `samples/{id}_epoch_{epoch}` — the per-sample prefix (no trailing slash). */
export const samplePrefix = (id: string | number, epoch: number): string =>
  `${SAMPLES_DIR}/${id}_epoch_${epoch}`;

/** Today's monolith sample entry name (`samples/{id}_epoch_{epoch}.json`). */
export const monolithEntryName = (id: string | number, epoch: number): string =>
  `${samplePrefix(id, epoch)}.json`;

export const shellEntryName = (id: string | number, epoch: number): string =>
  `${samplePrefix(id, epoch)}/${SHELL_JSON}`;

export const metadataEntryName = (id: string | number, epoch: number): string =>
  `${samplePrefix(id, epoch)}/${METADATA_JSON}`;

export const skeletonEntryName = (id: string | number, epoch: number): string =>
  `${samplePrefix(id, epoch)}/${SKELETON_JSON}`;

export const statsEntryName = (id: string | number, epoch: number): string =>
  `${samplePrefix(id, epoch)}/events/${STATS_JSON}`;

/** Event uuids in ordinal order (position = ordinal), lazily fetched. */
export const uuidsEntryName = (id: string | number, epoch: number): string =>
  `${samplePrefix(id, epoch)}/events/${UUIDS_JSON}`;

/** `{prefix}/{sequence}/{start}.json` — chunk holding items from `start`. */
export const chunkEntryName = (
  id: string | number,
  epoch: number,
  sequence: SequenceName,
  start: number
): string => `${samplePrefix(id, epoch)}/${sequence}/${start}.json`;

export type SampleShape = "monolith" | "chunked";

/**
 * Classify a sample's on-disk shape from zip entry names (the central
 * directory). Structural per-sample dispatch: one log may mix shapes.
 * Returns undefined when the sample has no entries at all.
 */
export const classifySampleShape = (
  entryNames: ReadonlySet<string>,
  id: string | number,
  epoch: number
): SampleShape | undefined =>
  entryNames.has(shellEntryName(id, epoch))
    ? "chunked"
    : entryNames.has(monolithEntryName(id, epoch))
      ? "monolith"
      : undefined;

/**
 * Chunk start indexes for a sequence, recovered from central-directory
 * entry names. Ascending; empty sequences have no chunk entries at all.
 * Non-numeric stems are skipped (`events/` also holds `stats.json`).
 */
export const sequenceChunkStarts = (
  entryNames: ReadonlySet<string>,
  id: string | number,
  epoch: number,
  sequence: SequenceName
): number[] => {
  const prefix = `${samplePrefix(id, epoch)}/${sequence}/`;
  const starts: number[] = [];
  for (const name of entryNames) {
    if (name.startsWith(prefix) && name.endsWith(".json")) {
      const stem = name.slice(prefix.length, -".json".length);
      if (/^\d+$/.test(stem)) {
        starts.push(Number(stem));
      }
    }
  }
  return starts.sort((a, b) => a - b);
};

/** Bounds-checked index (an out-of-range index is a coding error). */
export const at = <T>(items: readonly T[], i: number): T => {
  const item = items[i];
  if (item === undefined) {
    throw new Error(`Index ${i} out of range (length ${items.length})`);
  }
  return item;
};

/**
 * Index of the chunk holding item `i`: greatest start ≤ i (binary search
 * over ascending starts). Callers must ensure `0 ≤ i <` the sequence count.
 */
export const chunkIndexOf = (starts: readonly number[], i: number): number => {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (at(starts, mid) <= i) lo = mid;
    else hi = mid - 1;
  }
  return lo;
};
