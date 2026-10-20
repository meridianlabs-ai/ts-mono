import { scrollingAncestor } from "../hooks/scrollingAncestor";
import type { ScrollAnchor } from "../hooks/useChildScrollAnchoring";

import { kSourceLinesAttribute } from "./markdownText";

const kPending = "markdown-segment-pending";

/**
 * Swapping a markdown segment's source for its HTML moves the text inside it.
 * Find in page scrolls a match in the source to the viewport's center, so
 * this anchors the source line there, in whichever of the `indexes` children
 * of `container` still shows its source across the center.
 */
export const centerAnchor = (
  container: HTMLElement,
  indexes: number[]
): ScrollAnchor | undefined => {
  const scroller = scrollingAncestor(container);
  if (!scroller) {
    return undefined;
  }
  const view = scroller.getBoundingClientRect();
  const center = view.top + view.height / 2;
  for (const index of indexes) {
    const segment = container.children[index];
    if (!segment?.classList.contains(kPending)) {
      continue;
    }
    const box = segment.getBoundingClientRect();
    if (box.top > center || box.bottom <= center) {
      continue;
    }
    // WebKit's parser splits text longer than 64K characters into several
    // nodes.
    const texts = [...segment.childNodes].filter(
      (node): node is Text => node instanceof Text
    );
    let before = 0;
    for (const text of texts) {
      if (text !== texts.at(-1) && textBottom(text) <= center) {
        before += text.length;
        continue;
      }
      const offset = offsetAtY(text, center);
      const line = sourceLinePosition(segment.textContent, before + offset);
      return {
        target: segment,
        top: charTop(text, offset),
        scrollTop: scroller.scrollTop,
        capturedAt: performance.now(),
        locate: () => renderedLineTop(segment, line),
      };
    }
  }
  return undefined;
};

/** The line `offset` falls on, plus how far along that line it is. */
export const sourceLinePosition = (source: string, offset: number): number => {
  let line = 0;
  let lineStart = 0;
  for (let i = source.indexOf("\n"); i !== -1 && i < offset;) {
    line++;
    lineStart = i + 1;
    i = source.indexOf("\n", i + 1);
  }
  const lineEnd = source.indexOf("\n", lineStart);
  const length = (lineEnd === -1 ? source.length : lineEnd) - lineStart;
  return line + (length > 0 ? Math.min(1, (offset - lineStart) / length) : 0);
};

/**
 * Where a source line (as `sourceLinePosition` gives it) sits in a rendered
 * segment: as far through its block as it is through the block's lines, or
 * at the end of the block before it when it falls between blocks. Undefined
 * while the segment still shows its source.
 */
export const renderedLineTop = (
  segment: Element,
  line: number
): number | undefined => {
  if (segment.classList.contains(kPending)) {
    return undefined;
  }
  const block = [...segment.querySelectorAll(`[${kSourceLinesAttribute}]`)]
    .map((element) => {
      const [start = 0, end = 0] = (
        element.getAttribute(kSourceLinesAttribute) ?? ""
      )
        .split(" ")
        .map(Number);
      return { element, start, end };
    })
    .findLast(({ start }) => start <= line);
  if (!block) {
    return segment.getBoundingClientRect().top;
  }
  const box = block.element.getBoundingClientRect();
  const through = (line - block.start) / Math.max(1, block.end - block.start);
  return box.top + Math.min(1, through) * box.height;
};

const textBottom = (text: Text): number => {
  const range = document.createRange();
  range.selectNodeContents(text);
  return range.getBoundingClientRect().bottom;
};

const charTop = (text: Text, offset: number): number => {
  const range = document.createRange();
  // A line break can have no box of its own; the character before it shares
  // its row.
  for (let at = offset; ; at--) {
    range.setStart(text, at);
    range.setEnd(text, Math.min(at + 1, text.length));
    const box = range.getBoundingClientRect();
    if (box.height > 0 || at === 0) {
      return box.top;
    }
  }
};

// The last character whose row starts at or above `y`.
const offsetAtY = (text: Text, y: number): number => {
  let low = 0;
  let high = Math.max(0, text.length - 1);
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (charTop(text, mid) <= y) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return low;
};
