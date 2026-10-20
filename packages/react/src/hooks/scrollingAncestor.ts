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
