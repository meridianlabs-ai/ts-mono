import { findVariantHits, normalizeFindText, searchVariants } from "./findText";

// Elements whose text is never shown as page text.
const SKIPPED_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEMPLATE",
  "TEXTAREA",
  "SELECT",
]);

// Inline-block boxes (chips, badges, math) read as separate words.
const isInlineDisplay = (display: string): boolean =>
  display === "inline" || display === "contents";

interface TextRun {
  nodes: Text[];
  /** Each node's start in the run's text. */
  starts: number[];
  length: number;
}

/**
 * Every occurrence of `term` in the page text under `root`, in document
 * order, compared as `normalizeFindText` does so the page agrees with counts
 * taken from data. Skips text a reader can't find: `data-unsearchable`
 * subtrees, `user-select: none` (role labels, gutters), hidden elements and
 * non-text elements. Matches may cross element boundaries within one block
 * of text (syntax-highlight tokens, markdown emphasis), but never span two
 * blocks or a `<br>`.
 */
export function findTextMatches(root: Element, term: string): Range[] {
  const variants = searchVariants(term);
  if (variants.length === 0) return [];
  const doc = root.ownerDocument;
  const view = doc.defaultView;
  if (!view) return [];

  const displays = new Map<Element, string>();
  const visible = new Map<Element, boolean>();
  const styleOf = (el: Element) => view.getComputedStyle(el);
  const isVisible = (el: Element): boolean => {
    let result = visible.get(el);
    if (result === undefined) {
      result = styleOf(el).visibility === "visible";
      visible.set(el, result);
    }
    return result;
  };
  const displayOf = (el: Element): string => {
    let display = displays.get(el);
    if (display === undefined) {
      display = styleOf(el).display;
      displays.set(el, display);
    }
    return display;
  };
  const blockOf = (el: Element | null): Element | null => {
    let current = el;
    while (current && current !== root && isInlineDisplay(displayOf(current))) {
      current = current.parentElement;
    }
    return current;
  };

  const walker = doc.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        if (!(node instanceof Element)) return NodeFilter.FILTER_ACCEPT;
        if (SKIPPED_TAGS.has(node.tagName)) return NodeFilter.FILTER_REJECT;
        if (node.hasAttribute("data-unsearchable")) {
          return NodeFilter.FILTER_REJECT;
        }
        const style = styleOf(node);
        displays.set(node, style.display);
        visible.set(node, style.visibility === "visible");
        if (
          style.display === "none" ||
          style.userSelect === "none" ||
          // Safari computes only the prefixed property.
          style.getPropertyValue("-webkit-user-select") === "none"
        ) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    }
  );

  const matches: Range[] = [];

  const flush = (run: TextRun | null) => {
    if (!run) return;
    const offsets: number[] = [];
    const text = normalizeFindText(
      run.nodes.map((node) => node.data).join(""),
      offsets
    );
    for (const hit of findVariantHits(text, variants)) {
      const start = offsets[hit.start]!;
      const end = offsets[hit.end - 1]! + 1;
      const range = doc.createRange();
      const [startNode, startOffset] = locate(run, start, false);
      const [endNode, endOffset] = locate(run, end, true);
      range.setStart(startNode, startOffset);
      range.setEnd(endNode, endOffset);
      matches.push(range);
    }
  };

  let run: TextRun | null = null;
  let runBlock: Element | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node instanceof Element) {
      if (node.tagName === "BR" || !isInlineDisplay(displayOf(node))) {
        flush(run);
        run = null;
      }
      continue;
    }
    if (!(node instanceof Text) || node.data.length === 0) continue;
    const parent = node.parentElement;
    if (parent && !isVisible(parent)) continue;
    const block = blockOf(parent);
    if (run && block !== runBlock) {
      flush(run);
      run = null;
    }
    if (!run) {
      run = { nodes: [], starts: [], length: 0 };
      runBlock = block;
    }
    run.starts.push(run.length);
    run.nodes.push(node);
    run.length += node.data.length;
  }
  flush(run);
  return matches;
}

/**
 * The text node and offset for a raw position in a run. An end position on a
 * node boundary resolves to the end of the earlier node, so a range never
 * reaches into a node it doesn't cover.
 */
function locate(
  run: TextRun,
  position: number,
  isEnd: boolean
): [Text, number] {
  // Binary search for the last node starting before the position (at or
  // before it, for a start).
  let low = 0;
  let high = run.starts.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const start = run.starts[mid]!;
    if (isEnd ? start < position : start <= position) low = mid;
    else high = mid - 1;
  }
  return [run.nodes[low]!, position - run.starts[low]!];
}
