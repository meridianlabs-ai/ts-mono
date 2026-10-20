import { RefObject, useEffect } from "react";

import { scrollingAncestor } from "./scrollingAncestor";

/**
 * Keeps on-screen content still when children of `containerRef` that start
 * above the scroll viewport change height, by scrolling the nearest scrolling
 * ancestor by the same amount: what follows such a child stays put. That
 * includes a child straddling the viewport's top edge, because Safari renders
 * a content-visibility chunk only once it reaches the viewport, while its
 * visible part still shows the placeholder. Children whose height is an
 * estimate until they first render (content-visibility: auto) need it, or
 * scrolling up through them jumps.
 *
 * It leaves alone what something else already compensates: a scroller the
 * browser anchors natively (VirtualList opts its rows out with
 * `overflow-anchor: none`), and a VirtualList row entirely above the
 * viewport, which the virtualizer scrolls for itself.
 *
 * `childrenKey` must change whenever the container's set of children does.
 */
export const useChildScrollAnchoring = (
  containerRef: RefObject<HTMLElement | null>,
  childrenKey: unknown
): void => {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const heights = new Map<Element, number>();
    // Scrolling the remaining compensation: in VirtualList the scroll height
    // grows only once the virtualizer has measured the row, so a write past
    // the current end is clamped and has to be retried on the next frames.
    let owed = 0;
    let frame = 0;
    const settle = (scroller: HTMLElement, attempts: number) => {
      const before = scroller.scrollTop;
      scroller.scrollTop = before + owed;
      owed -= scroller.scrollTop - before;
      if (Math.abs(owed) >= 1 && attempts > 0) {
        frame = requestAnimationFrame(() => settle(scroller, attempts - 1));
      } else {
        owed = 0;
      }
    };
    const observer = new ResizeObserver((entries) => {
      const changes: { target: Element; delta: number }[] = [];
      for (const entry of entries) {
        const height = blockSize(entry);
        const previous = heights.get(entry.target);
        heights.set(entry.target, height);
        if (previous !== undefined && height !== previous) {
          changes.push({ target: entry.target, delta: height - previous });
        }
      }
      if (changes.length === 0) {
        return;
      }
      // Looked up now: the container may not have been scrollable when this
      // mounted (inside a collapsed panel, say).
      const scroller = scrollingAncestor(container);
      if (!scroller || anchoredNatively(container, scroller)) {
        return;
      }
      const viewportTop = scroller.getBoundingClientRect().top;
      const grown = changes.reduce((sum, change) => sum + change.delta, 0);
      const row = container.closest("[data-index]");
      if (row && row.getBoundingClientRect().bottom - grown <= viewportTop) {
        return;
      }
      changes.sort(
        (a, b) =>
          a.target.getBoundingClientRect().top -
          b.target.getBoundingClientRect().top
      );
      // Positions are read after layout, so undo the growth of the changed
      // children above each one to find where it was before this change.
      let grownAbove = 0;
      let compensation = 0;
      for (const { target, delta } of changes) {
        const topBefore = target.getBoundingClientRect().top - grownAbove;
        if (topBefore < viewportTop) {
          compensation += delta;
        }
        grownAbove += delta;
      }
      if (compensation !== 0) {
        cancelAnimationFrame(frame);
        owed += compensation;
        settle(scroller, kSettleFrames);
      }
    });
    for (const child of container.children) {
      observer.observe(child);
    }
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [containerRef, childrenKey]);
};

const kSettleFrames = 10;

const blockSize = (entry: ResizeObserverEntry): number =>
  entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height;

// Whether the browser anchors scrolling around the container's children
// itself: it supports scroll anchoring and nothing from the container up to
// the scroller opts its subtree out with `overflow-anchor: none`.
const anchoredNatively = (container: HTMLElement, scroller: HTMLElement) => {
  if (typeof CSS === "undefined" || !CSS.supports("overflow-anchor", "auto")) {
    return false;
  }
  for (let el: HTMLElement | null = container; el; el = el.parentElement) {
    if (getComputedStyle(el).overflowAnchor === "none") {
      return false;
    }
    if (el === scroller) {
      return true;
    }
  }
  return true;
};
