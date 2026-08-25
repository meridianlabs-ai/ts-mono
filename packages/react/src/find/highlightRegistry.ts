// Shared registry over the CSS Custom Highlight API. CSS.highlights is a
// page-global map, so rows can't each own a Highlight object — instead they
// contribute/retract Range sets keyed by an id and the registry rebuilds the
// two named highlights ("find-match" for every occurrence, "find-active"
// for the active occurrence in the active row).

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

function rebuild(): void {
  if (!supportsCustomHighlights()) return;
  const matchRanges: Range[] = [];
  const activeRanges: Range[] = [];
  for (const c of contributions.values()) {
    matchRanges.push(...c.matches);
    if (c.active) activeRanges.push(c.active);
  }
  if (matchRanges.length > 0) {
    CSS.highlights.set(FIND_MATCH_HIGHLIGHT, new Highlight(...matchRanges));
  } else {
    CSS.highlights.delete(FIND_MATCH_HIGHLIGHT);
  }
  if (activeRanges.length > 0) {
    CSS.highlights.set(FIND_ACTIVE_HIGHLIGHT, new Highlight(...activeRanges));
  } else {
    CSS.highlights.delete(FIND_ACTIVE_HIGHLIGHT);
  }
}

export function setHighlightContribution(
  id: string,
  matches: Range[],
  active: Range | null
): void {
  if (matches.length === 0 && active === null) {
    clearHighlightContribution(id);
    return;
  }
  contributions.set(id, { matches, active });
  rebuild();
}

export function clearHighlightContribution(id: string): void {
  if (!contributions.delete(id)) return;
  rebuild();
}

const FLASH_CLASS = "find-flash";
const FLASH_MS = 900;
const flashTimers = new WeakMap<Element, number>();

/** Briefly flash an element (the never-silent-jump fallback, D10): used when
 *  Custom Highlights are unsupported, or when the active occurrence isn't in
 *  the row's rendered text. Styled by the `.find-flash` rule in the shared
 *  theme stylesheet. */
export function flashElement(el: Element): void {
  const prev = flashTimers.get(el);
  if (prev !== undefined) {
    window.clearTimeout(prev);
    // Retrigger the CSS animation: removing and re-adding in the same frame
    // wouldn't restart it, so force a reflow between.
    el.classList.remove(FLASH_CLASS);
    if (el instanceof HTMLElement) void el.offsetWidth;
  }
  el.classList.add(FLASH_CLASS);
  flashTimers.set(
    el,
    window.setTimeout(() => {
      el.classList.remove(FLASH_CLASS);
      flashTimers.delete(el);
    }, FLASH_MS)
  );
}
