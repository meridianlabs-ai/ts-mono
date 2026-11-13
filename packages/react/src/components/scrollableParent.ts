/**
 * The nearest ancestor, `element` included, that scrolls vertically and has
 * content to scroll.
 */
export const findScrollableParent = (element: Element): HTMLElement | null => {
  let current =
    element instanceof HTMLElement ? element : element.parentElement;
  while (current && current !== document.body) {
    const { overflowY } = getComputedStyle(current);
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      current.scrollHeight > current.clientHeight
    ) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
};
