// Shared registry over the CSS Custom Highlight API. CSS.highlights is a
// page-global map, so rows can't each own a Highlight object — instead they
// contribute/retract Range sets keyed by an id, and the registry publishes
// the two named highlights ("find-match" for every occurrence, "find-active"
// for the active occurrence in the active row) from them.

export const FIND_MATCH_HIGHLIGHT = "find-match";
export const FIND_ACTIVE_HIGHLIGHT = "find-active";

interface Contribution {
  matches: Range[];
  active: Range | null;
}

const contributions = new Map<string, Contribution>();

export function supportsCustomHighlights(): boolean {
  return (
    typeof CSS !== "undefined" &&
    "highlights" in CSS &&
    typeof Highlight !== "undefined"
  );
}

// The active range lives in find-active only, so the two highlights never
// overlap and no priority rule decides which paints.
const matchRanges = (c: Contribution): Range[] =>
  c.active === null ? c.matches : c.matches.filter((r) => r !== c.active);
const activeRanges = (c: Contribution): Range[] =>
  c.active === null ? [] : [c.active];

/** Re-register the named Highlight from every contribution. A registered
 *  Highlight is re-processed by Firefox on each add/delete (about 1 ms per
 *  range, 40 s for the ten rows a wrap to the last hit mounts on the
 *  million-hit log), so the set is built detached and swapped in once. */
function publish(
  name: string,
  pick: (c: Contribution) => Range[],
  previous: Contribution | undefined,
  next: Contribution | undefined
): void {
  const highlight = new Highlight();
  for (const c of contributions.values()) {
    if (c === previous) continue;
    for (const range of pick(c)) highlight.add(range);
  }
  if (next) for (const range of pick(next)) highlight.add(range);
  if (highlight.size === 0) CSS.highlights.delete(name);
  else CSS.highlights.set(name, highlight);
}

function replaceContribution(id: string, next: Contribution | undefined): void {
  const previous = contributions.get(id);
  if (!previous && !next) return;
  if (supportsCustomHighlights()) {
    publish(FIND_MATCH_HIGHLIGHT, matchRanges, previous, next);
    publish(FIND_ACTIVE_HIGHLIGHT, activeRanges, previous, next);
  }
  if (next) contributions.set(id, next);
  else contributions.delete(id);
}

export function setHighlightContribution(
  id: string,
  matches: Range[],
  active: Range | null
): void {
  replaceContribution(
    id,
    matches.length === 0 && active === null ? undefined : { matches, active }
  );
}

export function clearHighlightContribution(id: string): void {
  replaceContribution(id, undefined);
}

const FLASH_CLASS = "find-flash";

/** Briefly flash an element (the never-silent-jump fallback): used when
 *  Custom Highlights are unsupported, or when the active occurrence isn't in
 *  the row's rendered text. The `.find-flash` rule in the shared theme
 *  stylesheet owns the animation; the class comes off when it ends. */
export function flashElement(el: Element): void {
  if (el.classList.contains(FLASH_CLASS)) {
    // Re-adding the class in the same frame wouldn't restart the animation;
    // replaying the running one does.
    for (const animation of el.getAnimations()) {
      animation.cancel();
      animation.play();
    }
    return;
  }
  el.classList.add(FLASH_CLASS);
  el.addEventListener("animationend", () => el.classList.remove(FLASH_CLASS), {
    once: true,
  });
}
