import {
  useVirtualizer,
  type VirtualItem,
  type Virtualizer,
} from "@tanstack/react-virtual";
import { useCallback, useMemo, useRef } from "react";

import {
  computeScale,
  SAFE_MAX_SPACER,
  toContent,
} from "./scale-coordinate-space";

export type ScaledVirtualizerOptions = {
  count: number;
  estimateSize: () => number;
  getScrollElement: () => HTMLElement | null;
  overscan?: number;
  scrollPaddingStart?: number;
  /** Offset (px) of the list within its scroll element, for embedded lists
   *  with content above them in a shared scroller. Item coordinates include
   *  it; getTotalSize() does not. NOT scale-aware — an embedded list large
   *  enough to engage scaling (>~16M px) is unsupported. */
  scrollMargin?: number;
};

export type ScaledVirtualizerResult = {
  virtualizer: Virtualizer<HTMLElement, Element>;
  scale: number;
  toContentScroll: (spacerScroll: number) => number;
};

export function useScaledVirtualizer(
  opts: ScaledVirtualizerOptions
): ScaledVirtualizerResult {
  const scaleRef = useRef(1);

  // Intercept scroll-offset reads: the browser reports spacer-space
  // scrollTop, we multiply by scale so TanStack sees content-space.
  const scaledObserveElementOffset = useMemo(
    () =>
      (
        instance: Virtualizer<HTMLElement, Element>,
        cb: (offset: number, isScrolling: boolean) => void
      ) => {
        const el = instance.scrollElement;
        if (!el) return;

        // Safari < 26 has no scrollend: fall back to a settle timeout like
        // virtual-core's default observer, else isScrolling never clears.
        const supportsScrollend = "onscrollend" in window;
        let settleTimer: ReturnType<typeof setTimeout> | undefined;
        const onScrollEnd = () => {
          cb(el.scrollTop * scaleRef.current, false);
        };
        const onScroll = () => {
          if (!supportsScrollend) {
            clearTimeout(settleTimer);
            settleTimer = setTimeout(
              onScrollEnd,
              instance.options.isScrollingResetDelay
            );
          }
          cb(el.scrollTop * scaleRef.current, true);
        };

        // Fire immediately to set initial offset
        onScrollEnd();

        el.addEventListener("scroll", onScroll, { passive: true });
        if (supportsScrollend)
          el.addEventListener("scrollend", onScrollEnd, { passive: true });
        return () => {
          clearTimeout(settleTimer);
          el.removeEventListener("scroll", onScroll);
          el.removeEventListener("scrollend", onScrollEnd);
        };
      },
    []
  );

  // Intercept scroll-to writes: TanStack provides content-space offset,
  // we divide by scale before setting the browser's scrollTop.
  const scaledScrollToFn = useCallback(
    (
      offset: number,
      {
        adjustments,
        behavior,
      }: { adjustments?: number; behavior?: ScrollBehavior },
      instance: Virtualizer<HTMLElement, Element>
    ) => {
      const el = instance.scrollElement;
      if (!el) return;
      const adjusted = offset + (adjustments ?? 0);
      el.scrollTo({
        top: adjusted / scaleRef.current,
        behavior,
      });
      // The virtualizer learns its offset from the scroll event, a task
      // later; a row measured before then (mounted by the render this write
      // interrupted) would be compensated against the old offset — judged
      // in the wrong place, and shifted from the wrong base. An instant
      // write has landed, so tell it now; its own adjustment writes already
      // add their delta to the offset.
      if (behavior !== "smooth" && adjustments === undefined) {
        instance.scrollOffset = el.scrollTop * scaleRef.current;
      }
    },
    []
  );

  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: opts.count,
    estimateSize: opts.estimateSize,
    getScrollElement: opts.getScrollElement,
    overscan: opts.overscan ?? 5,
    scrollPaddingStart: opts.scrollPaddingStart ?? 0,
    scrollMargin: opts.scrollMargin ?? 0,
    observeElementOffset: scaledObserveElementOffset,
    scrollToFn: scaledScrollToFn,
  });

  // TanStack's default adjusts scroll for any resized item whose START is
  // above the viewport top — which misclassifies a row the viewport is
  // scrolled INTO (sticky header pinned, content changing below it, e.g. a
  // tab swap): the full height delta lands on scrollTop and the view jumps
  // to the new content's tail. Only compensate for rows ENTIRELY above the
  // viewport (end <= offset instead of the default's start < offset). The
  // default's pending-adjustments term and backward-scroll re-measure guard
  // are deliberately omitted: an index jump is re-aimed by the virtualizer
  // after every measurement (scrollToIndex reconcile), which covers the
  // mid-jump cases those guards target. This is an
  // ASSIGNABLE INSTANCE HOOK in virtual-core 3.17 (not an option — nothing
  // copies it from options), hence the post-construction assignment.
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (
    item: VirtualItem,
    _delta: number,
    instance: Virtualizer<HTMLElement, Element>
  ) => item.end <= (instance.scrollOffset ?? 0);

  const contentTotal = virtualizer.getTotalSize();
  const scale = computeScale(contentTotal, SAFE_MAX_SPACER);
  scaleRef.current = scale;

  // Ref-backed (not closed over `scale`) so closures created before a
  // re-measure changed the scale convert with the current scale.
  const toContentScroll = useCallback(
    (spacerScroll: number) => toContent(spacerScroll, scaleRef.current),
    []
  );

  return { virtualizer, scale, toContentScroll };
}
