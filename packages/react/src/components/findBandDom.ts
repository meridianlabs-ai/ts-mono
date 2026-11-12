interface Scroller {
  el: HTMLElement;
  /** Scrolls vertically, horizontally. */
  y: boolean;
  x: boolean;
}

const scrollable = (overflow: string) =>
  overflow === "auto" || overflow === "scroll";

/** Ancestors with something to scroll, innermost first. */
function scrollAncestors(node: Node): Scroller[] {
  const scrollers: Scroller[] = [];
  for (
    let el = node.parentElement;
    el && el !== document.body && el !== document.documentElement;
    el = el.parentElement
  ) {
    const { overflowX, overflowY } = getComputedStyle(el);
    const y = scrollable(overflowY) && el.scrollHeight > el.clientHeight;
    const x = scrollable(overflowX) && el.scrollWidth > el.clientWidth;
    if (x || y) scrollers.push({ el, x, y });
  }
  return scrollers;
}

/** The vertical band of the window through which a range can be seen: the
 *  overlap of its vertical scroll ancestors' boxes and the window. */
function viewBand(range: Range): { top: number; bottom: number } {
  let top = 0;
  let bottom = window.innerHeight;
  for (const { el, y } of scrollAncestors(range.startContainer)) {
    if (!y) continue;
    const box = el.getBoundingClientRect();
    top = Math.max(top, box.top);
    bottom = Math.min(bottom, box.bottom);
  }
  return { top, bottom };
}

export function isRangeAboveView(range: Range): boolean {
  return range.getBoundingClientRect().bottom <= viewBand(range).top;
}

/** Opens any closed `<details>` around a range, so its text shows. */
export function openDetailsAround(range: Range): void {
  for (let el = range.startContainer.parentElement; el; el = el.parentElement) {
    if (el instanceof HTMLDetailsElement && !el.open) el.open = true;
  }
}

/**
 * Brings a range into view, centring it in each scroll ancestor that clips
 * it (on either axis), innermost first, and then in the window, as the
 * browser's own find does. A range already in view doesn't move anything.
 */
export function scrollRangeIntoView(range: Range): void {
  for (const { el, x, y } of scrollAncestors(range.startContainer)) {
    const rect = range.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    const options: ScrollToOptions = {};
    if (y && (rect.top < box.top || rect.bottom > box.bottom)) {
      options.top =
        el.scrollTop + rect.top - box.top - (box.height - rect.height) / 2;
    }
    if (x && (rect.left < box.left || rect.right > box.right)) {
      options.left =
        el.scrollLeft + rect.left - box.left - (box.width - rect.width) / 2;
    }
    if (options.top !== undefined || options.left !== undefined) {
      el.scrollTo(options);
    }
  }
  const rect = range.getBoundingClientRect();
  const options: ScrollToOptions = {};
  if (rect.top < 0 || rect.bottom > window.innerHeight) {
    options.top = rect.top - (window.innerHeight - rect.height) / 2;
  }
  if (rect.left < 0 || rect.right > window.innerWidth) {
    options.left = rect.left - (window.innerWidth - rect.width) / 2;
  }
  if (options.top !== undefined || options.left !== undefined) {
    window.scrollBy(options);
  }
}
