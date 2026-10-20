import { RefObject, useEffect } from "react";

import { scrollingAncestor } from "./scrollingAncestor";

/**
 * Keeps on-screen content still when children of `containerRef` that start
 * above the scroll viewport change height, by scrolling the nearest scrolling
 * ancestor by the same amount: what follows such a child stays put. That
 * includes a child straddling the viewport's top edge, because Safari renders
 * a content-visibility chunk only once it reaches the viewport, while its
 * visible part still shows the placeholder. Browsers do this natively (scroll
 * anchoring), but VirtualList turns it off for its scroller so it can't
 * fight the virtualizer's own resize compensation. Children whose height is
 * an estimate until they first render (content-visibility: auto) need it, or
 * scrolling up through them jumps.
 *
 * A child holding its own chunk container (`data-chunk-container`) anchors
 * its own chunks, so it is left to that container.
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
      // Looked up now: the container may not have been scrollable when this
      // mounted (inside a collapsed panel, say).
      const scroller = scrollingAncestor(container);
      if (changes.length === 0 || !scroller) {
        return;
      }
      const viewportTop = scroller.getBoundingClientRect().top;
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
        scroller.scrollTop += compensation;
      }
    });
    for (const child of container.children) {
      if (!child.querySelector("[data-chunk-container]")) {
        observer.observe(child);
      }
    }
    return () => observer.disconnect();
  }, [containerRef, childrenKey]);
};

const blockSize = (entry: ResizeObserverEntry): number =>
  entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height;
