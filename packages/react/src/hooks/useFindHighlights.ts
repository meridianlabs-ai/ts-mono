import {
  createContext,
  RefObject,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  useFindCoordinatorOptional,
  useFindState,
} from "../find/FindCoordinatorContext";
import {
  clearHighlightContribution,
  flashElement,
  setHighlightContribution,
  supportsCustomHighlights,
} from "../find/highlightRegistry";
import { findScrollableParent, scrollRangeToCenter } from "../find/rangeScroll";
import type { FindReveal } from "../find/types";
import {
  useVirtualScroller,
  type VirtualScroller,
} from "../virtual/VirtualScrollerContext";

// Per-row cap on painted ranges (matches beyond it still count). A guess,
// not calibrated; bounds Range churn on megabyte tool outputs.
const ROW_HIGHLIGHT_CAP = 1000;

/** Marks row chrome the source's text leaves out (chips, timestamps,
 *  metadata, indicators). Distinct from `data-unsearchable`, which the legacy
 *  window.find path also honours — this one must not change what that path
 *  finds. */
const FIND_CHROME_ATTR = "data-find-chrome";
const SKIPPED_SUBTREES = `[data-unsearchable], [${FIND_CHROME_ATTR}]`;
const MARKDOWN_PENDING = "[data-markdown-pending]";

interface TextSegment {
  node: Node;
  start: number;
}

/** What a find row exposes to the panels inside it: the active occurrence's
 *  Range as of the row's last scan (null when the active row is elsewhere or
 *  the occurrence is not rendered), and a subscription to every scan since. */
export interface FindRowHandle {
  activeRange(): Range | null;
  subscribe(listener: () => void): () => void;
}

class RowHandle implements FindRowHandle {
  private range: Range | null = null;
  private listeners = new Set<() => void>();

  activeRange = (): Range | null => this.range;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  publish(range: Range | null): void {
    if (range === null && this.range === null) return;
    this.range = range;
    for (const listener of this.listeners) listener();
  }
}

const FindRowContext = createContext<FindRowHandle | null>(null);

/** Wrap the row's children so collapsed panels can ask the row where its
 *  active occurrence is instead of scanning the row themselves. */
export const FindRowProvider = FindRowContext.Provider;

/** The enclosing find row, or null outside one (the legacy window.find
 *  path). */
export const useFindRow = (): FindRowHandle | null =>
  useContext(FindRowContext);

/**
 * Per-row highlighting over the CSS Custom Highlight API: every DOM
 * occurrence of the texts the source matched in this row, plus the active one
 * when this row is active. While mounted the row is attached to the
 * coordinator and reports its DOM match count once its markdown has
 * rendered; that count drives stepping inside it. A row that renders none of
 * its matches flashes instead (a jump is never silent), as does every row
 * where the API is missing. The active occurrence is shown only for the
 * reveal the row claims from the coordinator (one per activation; a
 * relocation onto the row requests none), once its range has a box: inside
 * a VirtualList through the virtualizer, re-run after the list measures the
 * row and, while the target was clamped short at the list end, after the
 * row itself grows.
 */
export function useFindHighlights(
  ref: RefObject<Element | null>,
  anchorId: string | null | undefined
): FindRowHandle {
  const { rows, activeRow, activeOccurrence } = useFindState();
  const coordinator = useFindCoordinatorOptional();
  const scroller = useVirtualScroller();
  const [handle] = useState(() => new RowHandle());
  const row =
    anchorId === null || anchorId === undefined
      ? undefined
      : rows.find((r) => r.anchor.id === anchorId);
  // The active occurrence within THIS row, or null when the active row is
  // elsewhere. Keyed so the effect re-runs (and re-flashes) per step.
  const active =
    row && activeRow !== null && rows[activeRow] === row
      ? activeOccurrence
      : null;
  // Keyed by content so the pattern (and the effect) survive a re-survey
  // that hands the row a fresh but equal `texts` array.
  const textsKey = row ? textsKeyOf(row.texts) : "";
  const pattern = useMemo(
    () => (textsKey ? variantsPattern(textsOfKey(textsKey)) : null),
    [textsKey]
  );
  const inWindow = row !== undefined;
  const contributionId = useId();
  // Refs, not effect locals: the effect re-runs (a re-survey, React's dev
  // cleanup+setup) before the range has a box, and the claim is one-shot.
  const reveal = useRef<FindReveal | null>(null);
  // A "jumped" target computed before the list measured the band sits on
  // estimated sizes and is moved by the correction.
  const measured = useRef(false);

  useLayoutEffect(() => {
    if (!coordinator || anchorId === null || anchorId === undefined) return;
    return coordinator.attachRow(anchorId);
  }, [coordinator, anchorId]);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || anchorId === null || anchorId === undefined || !inWindow) {
      clearHighlightContribution(contributionId);
      handle.publish(null);
      return;
    }
    if (active === null) reveal.current = null;
    else reveal.current = coordinator?.claimReveal(anchorId) ?? reveal.current;

    let flashed = false;
    // The list's jump to this row: made before the row mounted active, or
    // requested below; centring inside the row waits for it to land.
    let rowJump: "none" | "pending" | "landed" =
      reveal.current === "jumped" ? "landed" : "none";
    let markdownWasPending = false;
    let published: { ranges: Range[]; active: Range | null } | null = null;
    // The list's landing callback can arrive after this effect is gone.
    let disposed = false;
    if (!scroller) measured.current = true;
    const apply = () => {
      if (disposed) return;
      // Text still to be replaced by rendered markdown would be announced at
      // the wrong place with the wrong count; announce again once it renders.
      const markdownPending = root.querySelector(MARKDOWN_PENDING) !== null;
      if (markdownPending) markdownWasPending = true;
      else if (markdownWasPending) {
        markdownWasPending = false;
        flashed = false;
      }
      const { ranges, activeRange, count } = computeRowRanges(
        root,
        pattern,
        active
      );
      handle.publish(activeRange);
      coordinator?.reportRowCount(anchorId, markdownPending ? null : count);
      const settled = active !== null && !markdownPending;
      if (!supportsCustomHighlights()) {
        if (settled && reveal.current !== null) {
          reveal.current = null;
          flashElement(root);
        }
        return;
      }
      if (settled && reveal.current !== null) {
        if (activeRange !== null) {
          const force = reveal.current === "jumped";
          if (rowJump !== "pending" && (measured.current || !force)) {
            openEnclosingDetails(activeRange, root);
            const outcome = revealRange(
              activeRange,
              root,
              scroller,
              force,
              rowJump === "landed"
            );
            if (outcome === "shown") {
              reveal.current = null;
            } else if (outcome === "needs-row" && scroller) {
              rowJump = "pending";
              const landed = () => {
                rowJump = "landed";
                apply();
              };
              const node = activeRange.startContainer.parentElement ?? root;
              if (!scroller.scrollToRow(node, landed)) landed();
            }
          }
        } else if (!flashed) {
          flashed = true;
          flashElement(root);
        }
      }
      // Mutation and measure passes re-run this with the same text; a
      // contribution that did not change is not re-published (each publish
      // rebuilds the named highlights).
      if (!sameRanges(ranges, activeRange, published)) {
        published = { ranges, active: activeRange };
        setHighlightContribution(contributionId, ranges, activeRange);
      }
    };
    apply();

    const unsubscribeMeasure = scroller?.onRowMeasured((node) => {
      if (!node.contains(root)) return;
      measured.current = true;
      apply();
    });
    const observer = new MutationObserver(apply);
    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["data-markdown-pending"],
    });
    const resizeObserver =
      active === null
        ? null
        : new ResizeObserver(() => {
            if (reveal.current !== null) apply();
          });
    resizeObserver?.observe(root);
    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      observer.disconnect();
      unsubscribeMeasure?.();
      clearHighlightContribution(contributionId);
    };
  }, [
    ref,
    anchorId,
    inWindow,
    pattern,
    active,
    scroller,
    coordinator,
    contributionId,
    handle,
  ]);

  return handle;
}

/** One string per distinct text set; any character may appear in a text. */
const textsKeyOf = (texts: string[]): string =>
  [...new Set(texts)].map(encodeURIComponent).join(",");

const textsOfKey = (key: string): string[] =>
  key.split(",").map(decodeURIComponent);

const escapeRegExp = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Alternation of the matched texts, longest first so a variant that is a
 *  prefix of another cannot shadow it. Exact code points, no folding: the
 *  source already chose the substrings. */
export function variantsPattern(texts: string[]): RegExp {
  const sorted = [...texts].sort((a, b) => b.length - a.length);
  return new RegExp(sorted.map(escapeRegExp).join("|"), "gu");
}

interface RowRanges {
  /** Painted occurrences, capped at ROW_HIGHLIGHT_CAP. */
  ranges: Range[];
  /** The requested occurrence, uncapped; null when the row renders fewer. */
  activeRange: Range | null;
  /** All DOM occurrences, uncapped. */
  count: number;
}

/** The row's text nodes outside skipped subtrees, in document order, each
 *  with its offset into their plain concatenation. */
function collectRowSegments(root: Element): {
  segments: TextSegment[];
  text: string;
} {
  const segments: TextSegment[] = [];
  let text = "";
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest(SKIPPED_SUBTREES)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  for (let node; (node = walker.nextNode());) {
    segments.push({ node, start: text.length });
    text += node.nodeValue ?? "";
  }
  return { segments, text };
}

/** Occurrences of the pattern in the row's rendered text as DOM Ranges (may
 *  span element boundaries). */
export function computeRowRanges(
  root: Element,
  pattern: RegExp | null,
  activeOccurrence: number | null
): RowRanges {
  const { segments, text } = collectRowSegments(root);
  if (!pattern || segments.length === 0) {
    return { ranges: [], activeRange: null, count: 0 };
  }
  const toRange = (start: number, end: number): Range => {
    const range = document.createRange();
    const startSeg = segmentAt(segments, start);
    range.setStart(startSeg.node, start - startSeg.start);
    // end is exclusive: locate the segment containing the last character.
    const endSeg = segmentAt(segments, end - 1);
    range.setEnd(endSeg.node, end - endSeg.start);
    return range;
  };
  const ranges: Range[] = [];
  let activeRange: Range | null = null;
  let count = 0;
  for (const found of text.matchAll(pattern)) {
    const start = found.index;
    const end = start + found[0].length;
    if (count < ROW_HIGHLIGHT_CAP) ranges.push(toRange(start, end));
    if (count === activeOccurrence) {
      activeRange = ranges[count] ?? toRange(start, end);
    }
    count++;
  }
  return { ranges, activeRange, count };
}

/** A closed `<details>` lays out none of its content, so a match inside one
 *  has no box to centre (and would neither scroll nor flash): open every
 *  closed one between the range and the row. */
function openEnclosingDetails(range: Range, root: Element): void {
  for (
    let el = range.startContainer.parentElement;
    el && el !== root;
    el = el.parentElement
  ) {
    if (el instanceof HTMLDetailsElement && !el.open) el.open = true;
  }
}

const sameRange = (a: Range, b: Range): boolean =>
  a.startContainer === b.startContainer &&
  a.startOffset === b.startOffset &&
  a.endContainer === b.endContainer &&
  a.endOffset === b.endOffset;

function sameRanges(
  ranges: Range[],
  active: Range | null,
  published: { ranges: Range[]; active: Range | null } | null
): boolean {
  if (published === null || published.ranges.length !== ranges.length)
    return false;
  if ((active === null) !== (published.active === null)) return false;
  if (active && published.active && !sameRange(active, published.active))
    return false;
  return ranges.every((r, i) => sameRange(r, published.ranges[i]!));
}

/** Whether the range's box lies below the bottom edge of an ancestor that
 *  clips its overflow (a collapsed ExpandablePanel): the text has a layout
 *  position there but nothing shows at it, and in a virtual list that
 *  position is where later rows are laid out, so centring on it scrolls the
 *  row itself out of the mounted band. The panel opens for the active
 *  occurrence on the same publish; the row's resize re-runs the reveal. */
function isClippedByAncestor(
  rect: DOMRect,
  range: Range,
  root: Element
): boolean {
  for (
    let el = range.startContainer.parentElement;
    el && el !== root;
    el = el.parentElement
  ) {
    const overflow = getComputedStyle(el).overflowY;
    if (overflow !== "hidden" && overflow !== "clip") continue;
    if (rect.top >= el.getBoundingClientRect().bottom - 1) return true;
  }
  return false;
}

/** The range's first box with area: a range starting at a line wrap reports
 *  an empty box at the previous line's end first. */
function firstBox(range: Range): DOMRect | undefined {
  for (const rect of range.getClientRects()) {
    if (rect.width > 0 && rect.height > 0) return rect;
  }
  return undefined;
}

/** Whether a range's box is wholly inside `viewport` and not covered by
 *  something outside its row (a sticky header or tab bar inside the scroller
 *  hides a match that is geometrically within the viewport). */
function isRangeVisible(
  rect: DOMRect,
  viewport: DOMRect,
  root: Element
): boolean {
  if (rect.top < viewport.top || rect.bottom > viewport.bottom) return false;
  const x = rect.left + 1;
  const hitsRow = (y: number) => {
    // elementFromPoint answers only inside the window; a scroller taller
    // than it has nothing to cover the match out there.
    if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) {
      return true;
    }
    const hit = document.elementFromPoint(x, y);
    return hit !== null && root.contains(hit);
  };
  return hitsRow(rect.top + 1) && hitsRow(rect.bottom - 1);
}

type Reveal = "shown" | "waiting" | "needs-row";

/** Show the active occurrence. "waiting" when there is nothing to show yet:
 *  no box (unmeasured, not laid out, still inside a collapsed clip), or the
 *  scroll left the box out of view (a target past the list end while later
 *  rows sit at estimated sizes is clamped), so the caller retries on the
 *  next change. In a virtual list the row comes first: "needs-row" asks the
 *  caller to have the list bring the row in by index (the virtualizer
 *  re-aims that as rows measure); centring inside the row (a row taller
 *  than the viewport) follows once `rowLanded`, with `force` centring even
 *  an occurrence already in view (a row the list jumped to is edge-aligned). */
function revealRange(
  range: Range,
  root: Element,
  scroller: VirtualScroller | null,
  force: boolean,
  rowLanded: boolean
): Reveal {
  const rect = firstBox(range);
  if (rect === undefined || isClippedByAncestor(rect, range, root))
    return "waiting";
  if (scroller) {
    const viewport = scroller.viewportRect();
    if (!force && isRangeVisible(rect, viewport, root)) return "shown";
    if (!rowLanded) return "needs-row";
    const node = range.startContainer.parentElement ?? root;
    const landing: { box?: DOMRect } = {};
    scroller.centreInRow(node, rect, () => {
      // Rows measured after the scroll can move the virtualizer's own size
      // compensation over the landing: once the jump has settled, centre
      // again if that moved the occurrence out of view (one retry, no loop;
      // a scroll clamped short did not move and is retried when the row
      // grows).
      const settled = firstBox(range);
      if (
        settled !== undefined &&
        landing.box !== undefined &&
        settled.top !== landing.box.top &&
        !isRangeVisible(settled, scroller.viewportRect(), root)
      ) {
        scroller.centreInRow(node, settled);
      }
    });
    const after = firstBox(range);
    landing.box = after;
    return after !== undefined &&
      isRangeVisible(after, scroller.viewportRect(), root)
      ? "shown"
      : "waiting";
  }
  const parent = findScrollableParent(range.startContainer.parentElement);
  const viewport = parent
    ? parent.getBoundingClientRect()
    : new DOMRect(0, 0, window.innerWidth, window.innerHeight);
  if (force || !isRangeVisible(rect, viewport, root))
    scrollRangeToCenter(range);
  return "shown";
}

function segmentAt(segments: TextSegment[], pos: number): TextSegment {
  let lo = 0;
  let hi = segments.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segments[mid]!.start <= pos) lo = mid;
    else hi = mid - 1;
  }
  return segments[lo]!;
}
