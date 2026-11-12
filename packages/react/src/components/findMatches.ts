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
  /** The run's text as rendered: collapsible whitespace collapsed. */
  chars: string[];
  /** For each rendered character, its offset in the raw text. */
  rawOffsets: number[];
  nodes: Text[];
  /** Each node's start in the raw text. */
  starts: number[];
  rawLength: number;
  lastWasSpace: boolean;
}

// How a text node's own `white-space` treats its whitespace.
type Collapse = "all" | "spaces" | "none";

const collapseFor = (whiteSpace: string): Collapse =>
  whiteSpace === "normal" || whiteSpace === "nowrap"
    ? "all"
    : whiteSpace === "pre-line"
      ? "spaces"
      : "none";

const isCollapsible = (char: string, collapse: Collapse): boolean =>
  collapse === "all"
    ? char === " " ||
      char === "\t" ||
      char === "\n" ||
      char === "\r" ||
      char === "\f"
    : collapse === "spaces" && (char === " " || char === "\t");

/**
 * Every case-insensitive occurrence of `term` in the page text under `root`,
 * in document order. Skips text a reader can't find: `data-unsearchable`
 * subtrees, `user-select: none` (role labels, gutters), hidden elements and
 * non-text elements. Matches may cross element boundaries within one block
 * of text (syntax-highlight tokens, markdown emphasis), but never span two
 * blocks or a `<br>`. Whitespace matches as it renders: a run of spaces or a
 * line break in normal text reads as one space, as in the browser's find.
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
  const collapses = new Map<Element, Collapse>();
  const collapseOf = (el: Element | null): Collapse => {
    if (!el) return "all";
    let collapse = collapses.get(el);
    if (collapse === undefined) {
      collapse = collapseFor(styleOf(el).whiteSpace);
      collapses.set(el, collapse);
    }
    return collapse;
  };

  const flush = (run: TextRun | null) => {
    if (!run) return;
    for (const match of run.chars.join("").matchAll(pattern)) {
      const start = run.rawOffsets[match.index]!;
      const end = run.rawOffsets[match.index + match[0].length - 1]! + 1;
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
      run = {
        chars: [],
        rawOffsets: [],
        nodes: [],
        starts: [],
        rawLength: 0,
        lastWasSpace: false,
      };
      runBlock = block;
    }
    appendText(run, node, collapseOf(parent));
  }
  flush(run);
  return matches;
}

function appendText(run: TextRun, node: Text, collapse: Collapse): void {
  run.starts.push(run.rawLength);
  run.nodes.push(node);
  const data = node.data;
  for (let i = 0; i < data.length; i++) {
    const char = data[i]!;
    if (isCollapsible(char, collapse)) {
      if (run.lastWasSpace) continue;
      run.chars.push(" ");
      run.lastWasSpace = true;
    } else {
      run.chars.push(char);
      run.lastWasSpace = false;
    }
    run.rawOffsets.push(run.rawLength + i);
  }
  run.rawLength += data.length;
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
  let index = run.starts.length - 1;
  while (
    index > 0 &&
    (isEnd ? run.starts[index]! >= position : run.starts[index]! > position)
  ) {
    index--;
  }
  return [run.nodes[index]!, position - run.starts[index]!];
}
