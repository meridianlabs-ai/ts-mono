// Highlight names styled by `::highlight()` rules in @tsmono/theme base.css.
export const FIND_MATCH_HIGHLIGHT = "find-match";
export const FIND_CURRENT_HIGHLIGHT = "find-current";

/**
 * Paints every match, and the current one in its own colour. The current
 * range is left out of the match set so the two highlights never overlap.
 * Each Highlight is built before it is registered: Firefox re-processes a
 * registered Highlight on every add.
 */
export function paintFindHighlights(
  matches: readonly Range[],
  current: Range | null
): void {
  const others = matches.filter((range) => range !== current);
  setHighlight(FIND_MATCH_HIGHLIGHT, others);
  setHighlight(FIND_CURRENT_HIGHLIGHT, current ? [current] : []);
}

export function clearFindHighlights(): void {
  CSS.highlights.delete(FIND_MATCH_HIGHLIGHT);
  CSS.highlights.delete(FIND_CURRENT_HIGHLIGHT);
}

function setHighlight(name: string, ranges: readonly Range[]): void {
  if (ranges.length === 0) {
    CSS.highlights.delete(name);
  } else {
    const highlight = new Highlight();
    for (const range of ranges) highlight.add(range);
    CSS.highlights.set(name, highlight);
  }
}
