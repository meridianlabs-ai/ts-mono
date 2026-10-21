/**
 * Finds the nearest scrollable ancestor with enough overflow to benefit from
 * programmatic scrolling.
 */
export function findScrollableParent(
  element: Element | null,
  options?: { minScrollBuffer?: number }
): HTMLElement | null {
  const minBuffer = options?.minScrollBuffer ?? 100;
  let current =
    element instanceof HTMLElement ? element : element?.parentElement;

  while (current && current !== document.body) {
    const style = getComputedStyle(current);
    if (
      (style.overflowY === "auto" || style.overflowY === "scroll") &&
      current.scrollHeight > current.clientHeight + minBuffer
    ) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

/**
 * Centers the selected text range rather than its containing element, which
 * keeps matches in large elements such as code blocks correctly positioned.
 */
export function scrollRangeToCenter(
  range: Range,
  options?: { behavior?: ScrollBehavior; fallbackToScrollIntoView?: boolean }
): void {
  const { behavior = "auto", fallbackToScrollIntoView = true } = options ?? {};

  const rects = range.getClientRects();
  if (rects.length === 0) return;

  const selectionRect = rects[0];
  if (selectionRect === undefined) return;
  const scrollableParent = findScrollableParent(
    range.startContainer.parentElement
  );

  if (scrollableParent) {
    const parentRect = scrollableParent.getBoundingClientRect();
    const selectionOffsetInParent =
      selectionRect.top - parentRect.top + scrollableParent.scrollTop;
    const targetScrollTop =
      selectionOffsetInParent - scrollableParent.clientHeight / 2;

    scrollableParent.scrollTo({
      top: Math.max(0, targetScrollTop),
      behavior,
    });
  } else if (fallbackToScrollIntoView) {
    range.startContainer.parentElement?.scrollIntoView({
      behavior,
      block: "center",
    });
  }
}

/**
 * The nearest match of `term`, ignoring case, that crosses a boundary between
 * two chunks of a `data-chunk-container` (see `ChunkedText`). Chunks are
 * blocks, so `window.find` can't match across one. Searches after `from`, or
 * before it when `back`; the whole document without it.
 */
export function findAcrossChunks(
  term: string,
  back: boolean,
  from: Range | null
): Range | null {
  const overlap = term.length - 1;
  if (overlap < 1) {
    return null;
  }
  const lowerTerm = term.toLowerCase();
  let nearest: Range | null = null;
  for (const container of document.querySelectorAll("[data-chunk-container]")) {
    if (container.closest("[data-unsearchable]")) {
      continue;
    }
    const texts = [...container.children].map((chunk) => chunk.firstChild);
    for (let i = 0; i + 1 < texts.length; i++) {
      const before = texts[i];
      const after = texts[i + 1];
      if (!(before instanceof Text) || !(after instanceof Text)) {
        continue;
      }
      // Shorter than the term, so any match in it crosses the boundary.
      const tail = before.data.slice(-overlap);
      const joined = (tail + after.data.slice(0, overlap)).toLowerCase();
      for (
        let at = joined.indexOf(lowerTerm);
        at !== -1 && at < tail.length;
        at = joined.indexOf(lowerTerm, at + 1)
      ) {
        const range = document.createRange();
        range.setStart(before, before.length - tail.length + at);
        range.setEnd(after, at + term.length - tail.length);
        const inDirection =
          !from ||
          (back
            ? from.comparePoint(range.endContainer, range.endOffset) <= 0
            : from.comparePoint(range.startContainer, range.startOffset) >= 0);
        const nearer =
          !nearest ||
          range.compareBoundaryPoints(Range.START_TO_START, nearest) *
            (back ? -1 : 1) <
            0;
        if (inDirection && nearer) {
          nearest = range;
        }
      }
    }
  }
  return nearest;
}
