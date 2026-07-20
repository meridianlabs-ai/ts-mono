import { RefObject, useEffect } from "react";

// Keys that natively scroll the focused element's nearest scrollable
// ancestor — the same set VirtualList's own SCROLL_KEYS treats as "real user
// input" for follow-state purposes (see VirtualList.tsx). Shared here (and
// imported by VirtualList) so the two can't drift apart.
export const SCROLL_RELEASE_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  " ",
]);

/**
 * Releases "chrome nav ownership" back to natural scroll-direction detection
 * on a real user gesture. While `navOwnsRef.current` is true, a navigation
 * action (deep link, j/k/f/h/l, go-to-turn) owns whatever chrome-collapse
 * signal reads the ref, suppressing natural detection so programmatic
 * scrolls can't flicker it. A physical user gesture hands ownership back:
 * wheel/touch, or any of the keys that natively scroll the focused element's
 * nearest scrollable ancestor (Home/End/PageUp/PageDown/Arrow/Space) — this
 * matters even when focus sits on a plain button inside the scroller (e.g. a
 * turn-nav chevron) rather than the scroller itself, since the browser still
 * scrolls the container natively without the button consuming the key.
 *
 * One shared implementation for every "nav owns the chrome" call site
 * (previously hand-copied per surface, wheel/touch-only in each copy).
 */
export function useChromeNavOwnershipRelease(
  navOwnsRef: RefObject<boolean>,
  scrollRef: RefObject<HTMLElement | null>
): void {
  useEffect(() => {
    const release = (target: EventTarget | null) => {
      if (!navOwnsRef.current) return;
      const container = scrollRef.current;
      if (container && target instanceof Node && container.contains(target)) {
        navOwnsRef.current = false;
      }
    };
    // Wheel/touch only — NOT clicks: an outline/lane click is navigation (it
    // reclaims ownership itself), not a hand-back to natural scrolling.
    const onWheelOrTouch = (e: Event) => release(e.target);
    const onKeyDown = (e: KeyboardEvent) => {
      if (SCROLL_RELEASE_KEYS.has(e.key)) release(e.target);
    };
    const opts = { capture: true, passive: true } as const;
    window.addEventListener("wheel", onWheelOrTouch, opts);
    window.addEventListener("touchmove", onWheelOrTouch, opts);
    window.addEventListener("keydown", onKeyDown, opts);
    return () => {
      window.removeEventListener("wheel", onWheelOrTouch, opts);
      window.removeEventListener("touchmove", onWheelOrTouch, opts);
      window.removeEventListener("keydown", onKeyDown, opts);
    };
  }, [navOwnsRef, scrollRef]);
}
