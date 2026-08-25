import { RefObject, useId, useLayoutEffect } from "react";

import { useFindState } from "./FindCoordinatorContext";
import {
  clearHighlightContribution,
  flashElement,
  setHighlightContribution,
  supportsCustomHighlights,
} from "./highlightRegistry";
import { findTermOccurrences } from "./termMatching";

// Per-row cap on drawn highlight ranges: bounds the Range churn on
// pathological rows (megabyte tool outputs); matches beyond it still count,
// they just aren't painted.
const ROW_HIGHLIGHT_CAP = 1000;

interface TextSegment {
  node: Text;
  start: number;
}

/**
 * Per-row self-highlighting (D2/D10): while a find query is active, scan the
 * row's rendered text for the term and register DOM Ranges with the shared
 * Custom Highlight registry — `::highlight(find-match)` for every occurrence,
 * `::highlight(find-active)` for the active occurrence when this row is the
 * active match's anchor.
 *
 * The row locates the active match by occurrence index over its own rendered
 * text; when the rendered text has fewer occurrences than the index (the
 * projection and the render disagree), or Custom Highlights are unsupported,
 * the row flashes instead — a jump is never silent.
 *
 * Recomputes after every render and on a rAF-debounced MutationObserver, so
 * async text-node churn (Prism splitting code blocks) can't strand stale
 * ranges. `data-unsearchable` subtrees are skipped.
 */
export function useFindHighlights(
  ref: RefObject<Element | null>,
  anchorId: string | null | undefined
): void {
  const { term, matches, activeIndex } = useFindState();
  const activeMatch = activeIndex !== null ? matches[activeIndex] : undefined;
  // The active occurrence within THIS row, or null when the active match is
  // elsewhere. Keyed so the effect re-runs (and re-flashes) per step.
  const activeOccurrence =
    activeMatch &&
    anchorId !== null &&
    anchorId !== undefined &&
    activeMatch.anchor.id === anchorId
      ? (activeMatch.occurrence ?? 0)
      : null;
  const contributionId = useId();

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || anchorId === null || anchorId === undefined || !term) {
      clearHighlightContribution(contributionId);
      return;
    }

    // Flash at most once per activation (this effect re-runs per step);
    // mutation-driven recomputes must not re-flash.
    let flashed = false;
    const apply = () => {
      if (!supportsCustomHighlights()) {
        if (activeOccurrence !== null && !flashed) {
          flashed = true;
          flashElement(root);
        }
        return;
      }
      const ranges = computeRowRanges(root, term);
      let active: Range | null = null;
      if (activeOccurrence !== null) {
        active = ranges[activeOccurrence] ?? null;
        if (active === null && !flashed) {
          flashed = true;
          flashElement(root);
        }
      }
      setHighlightContribution(contributionId, ranges, active);
    };
    apply();

    let raf = 0;
    const observer = new MutationObserver(() => {
      if (raf !== 0) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        apply();
      });
    });
    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => {
      observer.disconnect();
      if (raf !== 0) cancelAnimationFrame(raf);
      clearHighlightContribution(contributionId);
    };
  }, [ref, anchorId, term, activeOccurrence, contributionId]);
}

/** All term occurrences in the row's rendered text as DOM Ranges (may span
 *  element boundaries), skipping data-unsearchable subtrees. Exported for
 *  tests only. */
export function computeRowRanges(root: Element, term: string): Range[] {
  const segments: TextSegment[] = [];
  let text = "";
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest("[data-unsearchable]")
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  for (let node; (node = walker.nextNode());) {
    if (!(node instanceof Text)) continue;
    segments.push({ node, start: text.length });
    text += node.data;
  }
  if (segments.length === 0) return [];
  const occurrences = findTermOccurrences(text, term).slice(
    0,
    ROW_HIGHLIGHT_CAP
  );
  return occurrences.map((o) => {
    const range = document.createRange();
    const startSeg = segmentAt(segments, o.start);
    range.setStart(startSeg.node, o.start - startSeg.start);
    // end is exclusive: locate the segment containing the last character.
    const endSeg = segmentAt(segments, o.end - 1);
    range.setEnd(endSeg.node, o.end - endSeg.start);
    return range;
  });
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
