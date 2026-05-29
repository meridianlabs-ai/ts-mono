import { useVirtualizer, type Virtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  computeScale,
  QUANTIZE_THRESHOLD,
  SAFE_MAX_SPACER,
  shouldRequantize,
  toContent,
  toSpacer,
} from "./scale-coordinate-space";

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
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack's useVirtualizer is a known external library hook
  const virtualizer = useVirtualizer({
    count: opts.count,
    estimateSize: opts.estimateSize,
    getScrollElement: opts.getScrollElement,
    overscan: opts.overscan ?? 5,
  });

  const [scale, setScale] = useState(1);
  const lastQuantizedTotalRef = useRef<number>(0);
  const hasLoggedTelemetryRef = useRef(false);

  const contentTotal = virtualizer.getTotalSize();

  useEffect(() => {
    const lastTotal = lastQuantizedTotalRef.current;
    if (shouldRequantize(scale, lastTotal, contentTotal, QUANTIZE_THRESHOLD)) {
      const newScale = computeScale(contentTotal, SAFE_MAX_SPACER);
      anchorScrollPositionAcrossScaleChange({
        virtualizer,
        oldScale: scale,
        newScale,
      });
      setScale(newScale);
      lastQuantizedTotalRef.current = contentTotal;
      if (!hasLoggedTelemetryRef.current && newScale > 1) {
        console.debug("[VirtualList] scaling engaged", {
          contentTotal,
          spacerHeight: contentTotal / newScale,
          s: newScale,
          itemCount: opts.count,
        });
        hasLoggedTelemetryRef.current = true;
      }
    }
  }, [contentTotal, scale, virtualizer, opts.count]);

  const spacerHeight = scale === 1 ? contentTotal : contentTotal / scale;

  const toContentScroll = useCallback(
    (spacerScroll: number) => toContent(spacerScroll, scale),
    [scale]
  );
  const toSpacerScroll = useCallback(
    (contentScroll: number) => toSpacer(contentScroll, scale),
    [scale]
  );

  return { virtualizer, scale, spacerHeight, toContentScroll, toSpacerScroll };
}

function anchorScrollPositionAcrossScaleChange(opts: {
  virtualizer: Virtualizer<HTMLElement, Element>;
  oldScale: number;
  newScale: number;
}) {
  const { virtualizer, oldScale, newScale } = opts;
  const scrollEl = virtualizer.scrollElement;
  if (!scrollEl) return;

  const items = virtualizer.getVirtualItems();
  const topItem = items[0];
  if (!topItem) return;

  const oldSpacerTop = topItem.start / oldScale;
  const viewportOffset = scrollEl.scrollTop - oldSpacerTop;
  const newSpacerTop = topItem.start / newScale;
  scrollEl.scrollTop = newSpacerTop + viewportOffset;
}
