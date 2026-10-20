// The nearest ancestor that scrolls now: an `overflow: auto` element whose
// content fits (a `pre` sized to its text) doesn't count.
export const scrollingAncestor = (element: HTMLElement): HTMLElement | null => {
  for (let el = element.parentElement; el; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el);
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      el.scrollHeight > el.clientHeight
    ) {
      return el;
    }
  }
  return null;
};

/**
 * The element that scrolls `element`: the scrolling ancestor if one scrolls
 * now, else the nearest ancestor set to scroll (whose content may not
 * overflow yet, as inside a collapsed panel).
 */
export const scrollContainer = (element: HTMLElement): HTMLElement | null => {
  const scrolling = scrollingAncestor(element);
  if (scrolling) {
    return scrolling;
  }
  for (let el = element.parentElement; el; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el);
    if (overflowY === "auto" || overflowY === "scroll") {
      return el;
    }
  }
  return null;
};
