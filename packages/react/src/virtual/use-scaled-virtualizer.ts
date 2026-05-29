import { useVirtualizer, type Virtualizer } from "@tanstack/react-virtual";
import { useCallback } from "react";

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

// Phase 1 ships scale fixed at 1 (no compression). The spec's coordinate-
// mapping design produces visible item overlap: it shrinks item positions in
// the spacer without shrinking item heights, so adjacent items collide.
// Real compression past the browser's max element height needs a custom
// scroll-position proxy intercepting TanStack's reads — tracked in the spec's
// Known Limitations section. For now, contentTotal under ~33M (Chrome) is
// supported; Firefox caps lower at ~17M.
export function useScaledVirtualizer(
  opts: ScaledVirtualizerOptions
): ScaledVirtualizerResult {
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack's useVirtualizer is a known external library hook
  const virtualizer = useVirtualizer({
    count: opts.count,
    estimateSize: opts.estimateSize,
    getScrollElement: opts.getScrollElement,
    overscan: opts.overscan ?? 5,
  });

  const spacerHeight = virtualizer.getTotalSize();
  const passthrough = useCallback((x: number) => x, []);

  return {
    virtualizer,
    scale: 1,
    spacerHeight,
    toContentScroll: passthrough,
    toSpacerScroll: passthrough,
  };
}
