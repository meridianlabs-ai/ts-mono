import type { FC } from "react";

import {
  useExtendedFind,
  type FindSource,
  type ItemMatchCount,
} from "../components/ExtendedFindContext";
import { findTextMatches } from "../components/findMatches";

/** Hands a test the find sources registered under the enclosing
 *  `ExtendedFindProvider`. */
export const FindSourcesProbe: FC<{
  onSources: (get: () => ReadonlyMap<string, FindSource>) => void;
}> = ({ onSources }) => {
  onSources(useExtendedFind().getFindSources);
  return null;
};

/** Matches Find highlights in a source's rendered rows, counted per item the
 *  way `FindSource.countByItem` reports them. */
export const domCountByItem = (
  source: FindSource,
  root: Element,
  term: string
): ItemMatchCount[] => {
  const counts = new Map<number, number>();
  for (const range of findTextMatches(root, term)) {
    const item = source.itemOf(range.startContainer);
    if (item !== null) counts.set(item, (counts.get(item) ?? 0) + 1);
  }
  return [...counts]
    .sort(([a], [b]) => a - b)
    .map(([item, count]) => ({ item, count }));
};
