import { RefObject, useCallback, useEffect, useRef } from "react";

// How far (px) below the detection line an element's top may sit and still
// count as "reached the top", so a jump/scroll that lands a hair short registers
// the target, not the element above it. One value for every consumer (and the
// j/k turn step) so they can't drift apart.
export const kScrollTrackTolerancePx = 24;

/**
 * Track which element is currently at the top of a scroll container.
 *
 * Calls `onElementVisible` when the element at the detection point (the top of
 * the viewport, just below any sticky chrome) changes. An element whose top
 * sits up to kScrollTrackTolerancePx below the line still counts as reached, so
 * a jump that lands a hair short registers the target, not the element above it.
 * At the very bottom of the scroll range, where the final elements can't reach
 * the line, it falls back to the last visible element so they can still become
 * current.
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

    // The detection line sits at the top of the viewport, just below the sticky
    // chrome - the current element is the lowest visible one whose top has
    // reached it (within kScrollTrackTolerancePx). Top-based, not
    // center-distance: a tall element landed at the top owns the line even
    // though its center is far below it. Binary (no sliding point), so it never
    // disagrees with where a jump lands its target.
    const detectionPoint = viewportTop;

    const elementIdSet = new Set(elementIds);

    const elements = container
      ? container.querySelectorAll("[id]")
      : document.querySelectorAll("[id]");

    let crossedId: string | null = null;
    let firstVisibleId: string | null = null;
    let lastVisibleId: string | null = null;
    for (const element of elements) {
      const id = element.id;
      if (!elementIdSet.has(id)) continue;
      const rect = element.getBoundingClientRect();
      if (rect.bottom < viewportTop || rect.top > viewportBottom) continue;
      if (firstVisibleId === null) firstVisibleId = id;
      lastVisibleId = id;
      if (rect.top <= detectionPoint + kScrollTrackTolerancePx) crossedId = id;
    }

    // At the very bottom of the scroll range the final rows can't reach the
    // detection line, so the lowest-crossed row lags on an earlier element -
    // take the last visible row instead so the final element(s) can still
    // become current. Keyed off literal proximity to max scroll (within the
    // shared tolerance), not a ratio, so it doesn't trip early on long content.
    if (container) {
      const maxScroll = container.scrollHeight - container.clientHeight;
      const nearBottom =
        maxScroll > 0 &&
        maxScroll - container.scrollTop <= kScrollTrackTolerancePx;
      if (nearBottom) return lastVisibleId ?? crossedId ?? firstVisibleId;
    }

    return crossedId ?? firstVisibleId;
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
