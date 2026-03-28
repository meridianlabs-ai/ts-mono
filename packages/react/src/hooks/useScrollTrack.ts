import { RefObject, useCallback, useEffect, useRef } from "react";

/**
 * Track which element is currently visible in a scroll container.
 *
 * Calls `onElementVisible` when the topmost visible element changes.
 * Uses a detection point that slides toward the bottom of the viewport
 * as the user scrolls near the end, so every item can be selected.
 */
export function useScrollTrack(
  elementIds: string[],
  onElementVisible: (id: string) => void,
  scrollRef?: RefObject<HTMLElement | null>,
  options?: { topOffset?: number; checkInterval?: number }
) {
  const currentVisibleRef = useRef<string | null>(null);
  const lastCheckRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);

  const findTopmostVisibleElement = useCallback(() => {
    const container = scrollRef?.current;
    const containerRect = container?.getBoundingClientRect();
    const topOffset = options?.topOffset ?? 50;

    // Define viewport bounds
    const viewportTop = containerRect
      ? containerRect.top + topOffset
      : topOffset;
    const viewportBottom = containerRect
      ? containerRect.bottom
      : window.innerHeight;
    const viewportHeight = viewportBottom - viewportTop;

    // Calculate dynamic threshold based on scroll position
    let detectionPoint = viewportTop;

    if (container) {
      const scrollHeight = container.scrollHeight;
      const scrollTop = container.scrollTop;
      const clientHeight = container.clientHeight;
      const maxScroll = scrollHeight - clientHeight;

      // Calculate how close we are to the bottom (0 = at top, 1 = at bottom)
      const scrollProgress = maxScroll > 0 ? scrollTop / maxScroll : 0;

      // Start sliding only in the last 20% of scroll
      const slideThreshold = 0.8;
      if (scrollProgress > slideThreshold) {
        const slideProgress =
          (scrollProgress - slideThreshold) / (1 - slideThreshold);
        const easedProgress = Math.pow(slideProgress, 3);
        detectionPoint = viewportTop + viewportHeight * 0.9 * easedProgress;
      }

      // When fully scrolled to bottom, use bottom of viewport
      if (scrollProgress >= 0.99) {
        detectionPoint = viewportBottom - 50;
      }
    }

    let closestId: string | null = null;
    let closestDistance = Infinity;

    const elementIdSet = new Set(elementIds);

    const elements = container
      ? container.querySelectorAll("[id]")
      : document.querySelectorAll("[id]");

    for (const element of elements) {
      const id = element.id;

      if (elementIdSet.has(id)) {
        const rect = element.getBoundingClientRect();

        if (rect.bottom >= viewportTop && rect.top <= viewportBottom) {
          const elementCenter = rect.top + rect.height / 2;
          const distance = Math.abs(elementCenter - detectionPoint);

          if (distance < closestDistance) {
            closestDistance = distance;
            closestId = id;
          }
        }
      }
    }

    return closestId;
  }, [elementIds, scrollRef, options?.topOffset]);

  const checkVisibility = useCallback(() => {
    const now = Date.now();
    const checkInterval = options?.checkInterval ?? 100;

    if (now - lastCheckRef.current < checkInterval) {
      return;
    }

    lastCheckRef.current = now;
    const topmostId = findTopmostVisibleElement();

    if (topmostId !== currentVisibleRef.current) {
      currentVisibleRef.current = topmostId;
      if (topmostId) {
        onElementVisible(topmostId);
      }
    }
  }, [findTopmostVisibleElement, onElementVisible, options?.checkInterval]);

  const handleScroll = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
    }

    rafRef.current = requestAnimationFrame(() => {
      checkVisibility();
      rafRef.current = null;
    });
  }, [checkVisibility]);

  useEffect(() => {
    if (elementIds.length === 0) return;

    const scrollElement = scrollRef?.current || window;

    checkVisibility();

    scrollElement.addEventListener("scroll", handleScroll, { passive: true });

    const intervalId = setInterval(checkVisibility, 1000);

    return () => {
      scrollElement.removeEventListener("scroll", handleScroll);
      clearInterval(intervalId);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [elementIds, scrollRef, handleScroll, checkVisibility]);
}
