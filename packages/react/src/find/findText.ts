/**
 * Canonical DOM text stream for find-in-page.
 *
 * Both corpus indexing (offscreen render) and match painting (mounted row)
 * walk text through THIS module, so occurrence counts and painted ranges are
 * derived from identical character streams by construction.
 */

/** Elements carrying this attribute (and their subtrees) are invisible to
 *  find: chrome whose text differs between the offscreen corpus render and
 *  the mounted row (turn-nav cluster, more/less toggles, collapsed summaries)
 *  must be marked with it on BOTH renders. */
export const FIND_IGNORE_ATTR = "data-find-ignore";

export interface FindTextStream {
  /** Concatenated, case-folded text of all accepted text nodes. */
  lowerText: string;
  /** Accepted text nodes, in document order. */
  nodes: Text[];
  /** Start offset of each node's text within `lowerText`. */
  starts: number[];
}

// Length-preserving case fold: offsets into the lowered stream must map 1:1
// onto original node offsets, and toLowerCase can change string length for a
// few characters (e.g. Turkish dotted I) — keep those unchanged instead.
export const lowerPreservingLength = (raw: string): string => {
  const lower = raw.toLowerCase();
  if (lower.length === raw.length) return lower;
  let out = "";
  for (const ch of raw) {
    const l = ch.toLowerCase();
    out += l.length === ch.length ? l : ch;
  }
  return out;
};

const isIgnored = (el: Element | null, root: Element): boolean => {
  for (let e = el; e && e !== root; e = e.parentElement) {
    if (e.hasAttribute(FIND_IGNORE_ATTR)) return true;
  }
  return false;
};

/** Walk `root`'s text nodes (skipping FIND_IGNORE_ATTR subtrees) into a
 *  concatenated lowered stream with node offsets. */
export const collectFindText = (root: Element): FindTextStream => {
  const walker = root.ownerDocument.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT
  );
  const nodes: Text[] = [];
  const starts: number[] = [];
  let lowerText = "";
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n as Text;
    if (isIgnored(text.parentElement, root)) continue;
    nodes.push(text);
    starts.push(lowerText.length);
    lowerText += lowerPreservingLength(text.data);
  }
  return { lowerText, nodes, starts };
};

/** Lowered searchable text of `root` — the indexer's corpus for one segment. */
export const findTextOfElement = (root: Element): string =>
  collectFindText(root).lowerText;

/** Count occurrences of `lowerTerm` in `lowerText` without allocating per
 *  occurrence. Empty terms return 0 (indexOf would loop forever). */
export const countOccurrences = (
  lowerText: string,
  lowerTerm: string
): number => {
  if (lowerTerm.length === 0) return 0;
  let count = 0;
  let pos = 0;
  while ((pos = lowerText.indexOf(lowerTerm, pos)) !== -1) {
    count++;
    pos += lowerTerm.length;
  }
  return count;
};

const streamOffsetToNodePosition = (
  stream: FindTextStream,
  offset: number
): { node: Text; offset: number } | null => {
  const { nodes, starts } = stream;
  // Binary search for the node containing `offset`.
  let lo = 0;
  let hi = nodes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  const node = nodes[lo];
  if (!node) return null;
  const local = offset - starts[lo]!;
  // A match can END exactly at a node boundary; Range accepts offset == length.
  if (local > node.data.length) return null;
  return { node, offset: local };
};

/** Build a Range covering the `occurrence`-th (0-based, non-overlapping,
 *  left-to-right) match of `lowerTerm` under `root`, or null when the mounted
 *  content doesn't (yet) contain that occurrence. */
export const rangeForOccurrence = (
  root: Element,
  lowerTerm: string,
  occurrence: number
): Range | null => {
  if (lowerTerm.length === 0 || occurrence < 0) return null;
  const stream = collectFindText(root);
  let pos = 0;
  let seen = -1;
  while ((pos = stream.lowerText.indexOf(lowerTerm, pos)) !== -1) {
    seen++;
    if (seen === occurrence) {
      const start = streamOffsetToNodePosition(stream, pos);
      const end = streamOffsetToNodePosition(stream, pos + lowerTerm.length);
      if (!start || !end) return null;
      const range = root.ownerDocument.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      return range;
    }
    pos += lowerTerm.length;
  }
  return null;
};
