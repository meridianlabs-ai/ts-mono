import type { ItemMatchCount } from "./ExtendedFindContext";

/** Identifies one match. Page text outside any list has `source: null` and
 *  `item` set to the match's index among page matches. */
export interface MatchKey {
  source: string | null;
  item: number;
  occurrence: number;
}

/** One page match, or one list item's matches. */
export interface MatchEntry {
  source: string | null;
  item: number;
  count: number;
  /** The rendered matches; null for a list item that isn't rendered, whose
   *  count comes from the list's data. */
  ranges: readonly Range[] | null;
}

export interface SourceMatches {
  id: string;
  /** How many page matches come before the list. */
  position: number;
  dataCounts: readonly ItemMatchCount[];
  /** DOM matches by rendered item. */
  rendered: ReadonlyMap<number, readonly Range[]>;
  renderedItems: ReadonlySet<number>;
}

/**
 * Orders every match: page matches in document order, each list's items
 * spliced in at its position. A rendered item counts its DOM matches, so the
 * count agrees with what's highlighted; an item that isn't rendered counts
 * its data matches.
 */
export function buildEntries(
  pageRanges: readonly Range[],
  sources: readonly SourceMatches[]
): MatchEntry[] {
  const ordered = [...sources].sort((a, b) => a.position - b.position);
  const entries: MatchEntry[] = [];
  let next = 0;
  const pushPage = (until: number) => {
    for (; next < until; next++) {
      entries.push({
        source: null,
        item: next,
        count: 1,
        ranges: [pageRanges[next]!],
      });
    }
  };
  for (const source of ordered) {
    pushPage(source.position);
    // One push per entry: spreading a large list exceeds the argument limit.
    for (const entry of sourceEntries(source)) entries.push(entry);
  }
  pushPage(pageRanges.length);
  return entries;
}

function sourceEntries(source: SourceMatches): MatchEntry[] {
  const counts = new Map<number, number>();
  for (const { item, count } of source.dataCounts) counts.set(item, count);
  for (const item of source.rendered.keys()) counts.set(item, 0);
  const entries: MatchEntry[] = [];
  for (const item of [...counts.keys()].sort((a, b) => a - b)) {
    const ranges = source.rendered.get(item);
    if (ranges) {
      entries.push({ source: source.id, item, count: ranges.length, ranges });
    } else if (!source.renderedItems.has(item)) {
      entries.push({
        source: source.id,
        item,
        count: counts.get(item)!,
        ranges: null,
      });
    }
  }
  return entries;
}

export function totalMatches(entries: readonly MatchEntry[]): number {
  let total = 0;
  for (const entry of entries) total += entry.count;
  return total;
}

/** The 0-based ordinal of a key, or null when its entry is gone. An
 *  occurrence past the entry's count clamps to its last match. */
export function ordinalOf(
  entries: readonly MatchEntry[],
  key: MatchKey
): number | null {
  let ordinal = 0;
  for (const entry of entries) {
    if (entry.source === key.source && entry.item === key.item) {
      return ordinal + Math.min(key.occurrence, entry.count - 1);
    }
    ordinal += entry.count;
  }
  return null;
}

/** The key at an ordinal, wrapping at both ends. Null when nothing matches. */
export function keyAt(
  entries: readonly MatchEntry[],
  ordinal: number
): MatchKey | null {
  const total = totalMatches(entries);
  if (total === 0) return null;
  let remaining = ((ordinal % total) + total) % total;
  for (const entry of entries) {
    if (remaining < entry.count) {
      return { source: entry.source, item: entry.item, occurrence: remaining };
    }
    remaining -= entry.count;
  }
  return null;
}

/** The rendered range for a key, if its item is rendered. */
export function rangeOf(
  entries: readonly MatchEntry[],
  key: MatchKey
): Range | null {
  const entry = entries.find(
    (e) => e.source === key.source && e.item === key.item
  );
  if (!entry?.ranges || entry.ranges.length === 0) return null;
  return entry.ranges[Math.min(key.occurrence, entry.ranges.length - 1)]!;
}
