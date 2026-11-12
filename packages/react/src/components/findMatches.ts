// Elements whose text is never shown as page text.
const SKIPPED_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEMPLATE",
  "TEXTAREA",
  "SELECT",
]);

const escapeRegExp = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Inline-block boxes (chips, badges, math) read as separate words.
const isInlineDisplay = (display: string): boolean =>
  display === "inline" || display === "contents";

interface TextRun {
  text: string;
  nodes: Text[];
  starts: number[];
}

/**
 * Every case-insensitive occurrence of `term` in the page text under `root`,
 * in document order. Skips text a reader can't find: `data-unsearchable`
 * subtrees, `user-select: none` (role labels, gutters), hidden elements and
 * non-text elements. Matches may cross element boundaries within one block
 * of text (syntax-highlight tokens, markdown emphasis), but never span two
 * blocks or a `<br>`.
 */
export function findTextMatches(root: Element, term: string): Range[] {
  if (!term) return [];
  const pattern = new RegExp(escapeRegExp(term), "giu");
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
    for (const match of run.text.matchAll(pattern)) {
      const start = match.index;
      const end = start + match[0].length;
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
      run = { text: "", nodes: [], starts: [] };
      runBlock = block;
    }
    run.starts.push(run.text.length);
    run.nodes.push(node);
    run.text += node.data;
  }
  flush(run);
  return matches;
}

/**
 * The text node and offset for a position in a run. An end position on a
 * node boundary resolves to the end of the earlier node, so a range never
 * reaches into a node it doesn't cover.
 */
function locate(
  run: TextRun,
  position: number,
  isEnd: boolean
): [Text, number] {
  let index = run.starts.length - 1;
  while (
    index > 0 &&
    (isEnd ? run.starts[index]! >= position : run.starts[index]! > position)
  ) {
    index--;
  }
  return [run.nodes[index]!, position - run.starts[index]!];
}
