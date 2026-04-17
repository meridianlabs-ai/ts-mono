import {
  RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const asArray = <T>(v: T | ReadonlyArray<T>): ReadonlyArray<T> =>
  Array.isArray(v) ? (v as ReadonlyArray<T>) : [v as T];

interface UseScrollDirectionOptions {
  /** Minimum px delta before recognizing a direction change. Default: 15 */
  threshold?: number;
  /** Lock duration (ms) after a state change, matching the CSS transition.
   *  Prevents the height change from the collapse/expand animation from
   *  immediately triggering the opposite direction. Default: 250 */
  transitionLockMs?: number;
  /** When current value is true, all scroll events are ignored and the
   *  direction anchor is reset when suppression ends. Useful for
   *  programmatic scrolls (e.g. outline click → scrollToEvent). */
  suppressRef?: React.RefObject<boolean>;
}

interface UseScrollDirectionResult {
  /** True when scrolling down past threshold while scrollTop > 10px */
  hidden: boolean;
  /** Call before a programmatic scroll or layout change that will shift
   *  scrollTop without the user actually scrolling. Resets the direction
   *  anchor to the current scrollTop and engages the transition lock so
   *  the resulting scroll-position shift is ignored.
   *
   *  @param debounce When true, each scroll event that arrives during the
   *    lock resets the expiry timer so the lock stays active until scrolling
   *    stops (useful for Virtuoso multi-pass settling). When false (default),
   *    the lock uses a fixed timeout matching the CSS transition duration. */
  resetAnchor: (debounce?: boolean) => void;
}

/**
 * Tracks scroll direction on one or more container elements with hysteresis
 * to prevent jitter. Returns a `hidden` boolean suitable for driving
 * headroom-style show/hide behaviors.
 *
 * Uses per-element anchor-based thresholds: a given element's direction only
 * changes after the user scrolls at least `threshold` px from that element's
 * last recognized change point. Scroll events on any element participate —
 * useful when the view has several independently-scrollable regions (e.g.
 * a main list plus side panels) that should all drive the same headroom.
 *
 * After each state change, updates are suppressed for `transitionLockMs` to
 * let CSS animations settle without triggering feedback loops.
 *
 * Scroll containers may be conditionally rendered (refs start as null).
 * An internal MutationObserver on `document.body` detects when elements
 * appear so scroll listeners are attached promptly.
 */
export function useScrollDirection(
  scrollRef:
    | RefObject<HTMLElement | null>
    | ReadonlyArray<RefObject<HTMLElement | null>>,
  options?: UseScrollDirectionOptions
): UseScrollDirectionResult {
  const threshold = options?.threshold ?? 40;
  const transitionLockMs = options?.transitionLockMs ?? 250;
  const suppressRef = options?.suppressRef;

  // Per-element anchor & last-direction tracking so multiple independent
  // scrollers don't cross-contaminate each other's threshold computations.
  const directionAnchorsRef = useRef<WeakMap<HTMLElement, number>>(
    new WeakMap()
  );
  const lastDirectionsRef = useRef<WeakMap<HTMLElement, "up" | "down">>(
    new WeakMap()
  );
  const transitionLockedRef = useRef(false);
  // True when the lock was set by resetAnchor (programmatic scroll).
  // Programmatic locks debounce: each scroll event resets the timer so the
  // lock stays active while Virtuoso settles. Transition locks (from
  // setHidden) use a fixed timeout so direction reversals aren't delayed.
  const programmaticLockRef = useRef(false);
  const lockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hidden, setHidden] = useState(false);

  // Normalize input to an array of refs.
  const refArray: ReadonlyArray<RefObject<HTMLElement | null>> = useMemo(
    () => asArray(scrollRef),
    // Array identity changes each render unless the caller memoizes — treat
    // the joined length + identity of the first ref as the stable key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    Array.isArray(scrollRef) ? scrollRef : [scrollRef]
  );

  // The primary scroll element (used by resetAnchor — typically the main
  // list's scroller).
  const primaryRef = refArray[0];

  // Resolve the actual DOM elements. Refs may be conditionally rendered
  // (null on first mount). A MutationObserver picks them up when they
  // appear.
  const [scrollEls, setScrollEls] = useState<HTMLElement[]>([]);

  useEffect(() => {
    const sync = () => {
      const resolved = refArray
        .map((r) => r.current)
        .filter((el): el is HTMLElement => el != null);
      setScrollEls((prev) => {
        if (
          prev.length === resolved.length &&
          prev.every((el, i) => el === resolved[i])
        ) {
          return prev;
        }
        return resolved;
      });
    };
    sync();

    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [refArray]);

  // Reset hidden state when the primary scroll element changes.
  const [prevPrimary, setPrevPrimary] = useState<HTMLElement | null>(
    scrollEls[0] ?? null
  );
  const primaryEl = scrollEls[0] ?? null;
  if (prevPrimary !== primaryEl) {
    setPrevPrimary(primaryEl);
    if (hidden) {
      setHidden(false);
    }
  }

  // Attach scroll listeners to all resolved elements.
  useEffect(() => {
    directionAnchorsRef.current = new WeakMap();
    lastDirectionsRef.current = new WeakMap();
    transitionLockedRef.current = false;

    if (scrollEls.length === 0) return;

    // Track previous suppression state to reset anchors when suppression ends.
    let wasSuppressed = suppressRef?.current ?? false;

    const makeHandler = (el: HTMLElement) => () => {
      const isSuppressed = suppressRef?.current ?? false;

      // When suppression ends, reset this element's anchor to the current
      // position so the first real scroll after the programmatic one starts
      // fresh.
      if (wasSuppressed && !isSuppressed) {
        directionAnchorsRef.current.set(el, el.scrollTop);
      }
      wasSuppressed = isSuppressed;

      if (isSuppressed) {
        directionAnchorsRef.current.set(el, el.scrollTop);
        return;
      }

      const scrollTop = el.scrollTop;

      // At the very top — always reveal headroom and reset anchor so the
      // threshold doesn't fight subsequent downward scrolls.
      if (scrollTop <= 0) {
        directionAnchorsRef.current.set(el, 0);
        lastDirectionsRef.current.set(el, "up");
        if (!transitionLockedRef.current) {
          setHidden(false);
        }
        return;
      }

      // At the very bottom — ignore overscroll bounce.
      const atBottom = el.scrollHeight - scrollTop - el.clientHeight < 1;
      if (atBottom) {
        directionAnchorsRef.current.set(el, scrollTop);
        return;
      }

      const anchor = directionAnchorsRef.current.get(el) ?? 0;
      const delta = scrollTop - anchor;

      if (Math.abs(delta) < threshold) return;

      const direction = delta > 0 ? "down" : "up";
      const prevDirection = lastDirectionsRef.current.get(el) ?? "down";
      const directionChanged = direction !== prevDirection;

      directionAnchorsRef.current.set(el, scrollTop);

      if (directionChanged) {
        lastDirectionsRef.current.set(el, direction);
      }

      if (transitionLockedRef.current) {
        if (programmaticLockRef.current && lockTimerRef.current !== null) {
          clearTimeout(lockTimerRef.current);
          lockTimerRef.current = setTimeout(() => {
            transitionLockedRef.current = false;
            programmaticLockRef.current = false;
            lockTimerRef.current = null;
            directionAnchorsRef.current.set(el, el.scrollTop);
          }, transitionLockMs);
        }
        return;
      }

      const shouldHide = direction === "down" && scrollTop > 10;
      setHidden((prev) => {
        if (prev === shouldHide) return prev;
        transitionLockedRef.current = true;
        if (lockTimerRef.current !== null) {
          clearTimeout(lockTimerRef.current);
        }
        lockTimerRef.current = setTimeout(() => {
          transitionLockedRef.current = false;
          lockTimerRef.current = null;
        }, transitionLockMs);
        return shouldHide;
      });
    };

    const handlers = scrollEls.map((el) => {
      const handler = makeHandler(el);
      el.addEventListener("scroll", handler, { passive: true });
      return { el, handler };
    });
    return () => {
      for (const { el, handler } of handlers) {
        el.removeEventListener("scroll", handler);
      }
    };
  }, [scrollEls, threshold, transitionLockMs, suppressRef]);

  const resetAnchor = useCallback(
    (debounce?: boolean) => {
      const primary = primaryRef?.current ?? null;
      if (primary) {
        directionAnchorsRef.current.set(primary, primary.scrollTop);
      }
      transitionLockedRef.current = true;
      programmaticLockRef.current = !!debounce;
      if (lockTimerRef.current !== null) {
        clearTimeout(lockTimerRef.current);
      }
      lockTimerRef.current = setTimeout(() => {
        transitionLockedRef.current = false;
        programmaticLockRef.current = false;
        lockTimerRef.current = null;
      }, transitionLockMs);
    },
    [primaryRef, transitionLockMs]
  );

  return { hidden, resetAnchor };
}
