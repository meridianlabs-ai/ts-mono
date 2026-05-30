import { useVirtualizer, type Virtualizer } from "@tanstack/react-virtual";
import { useCallback, useMemo, useRef } from "react";

import { computeScale, SAFE_MAX_SPACER } from "./scale-coordinate-space";

export type ScaledVirtualizerOptions = {
  count: number;
  estimateSize: () => number;
  getScrollElement: () => HTMLElement | null;
  overscan?: number;
};

export type ScaledVirtualizerResult = {
  virtualizer: Virtualizer<HTMLElement, Element>;
  scale: number;
  spacerHeight: number;
  toContentScroll: (spacerScroll: number) => number;
  toSpacerScroll: (contentScroll: number) => number;
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

        const onScroll = () => {
          cb(el.scrollTop * scaleRef.current, true);
        };
        const onScrollEnd = () => {
          cb(el.scrollTop * scaleRef.current, false);
        };

        // Fire immediately to set initial offset
        cb(el.scrollTop * scaleRef.current, false);

        el.addEventListener("scroll", onScroll, { passive: true });
        el.addEventListener("scrollend", onScrollEnd, { passive: true });
        return () => {
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
    },
    []
  );

  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: opts.count,
    estimateSize: opts.estimateSize,
    getScrollElement: opts.getScrollElement,
    overscan: opts.overscan ?? 5,
    observeElementOffset: scaledObserveElementOffset,
    scrollToFn: scaledScrollToFn,
  });

  const contentTotal = virtualizer.getTotalSize();
  const scale = computeScale(contentTotal, SAFE_MAX_SPACER);
  scaleRef.current = scale;

  const spacerHeight = scale === 1 ? contentTotal : SAFE_MAX_SPACER;

  const toContentScroll = useCallback(
    (spacerScroll: number) => spacerScroll * scale,
    [scale]
  );
  const toSpacerScroll = useCallback(
    (contentScroll: number) => contentScroll / scale,
    [scale]
  );

  return { virtualizer, scale, spacerHeight, toContentScroll, toSpacerScroll };
}
