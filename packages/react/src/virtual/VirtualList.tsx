import clsx from "clsx";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";

import {
  useExtendedFind,
  type ExtendedCountFn,
  type ExtendedFindFn,
} from "../components/ExtendedFindContext";
import { prepareSearchTerm } from "../components/prepareSearchTerm";
import { PulsingDots } from "../components/PulsingDots";
import { usePreviousValue } from "../hooks/usePreviousValue";
import { useProperty } from "../hooks/useProperty";
import { useRafThrottle } from "../hooks/useRafThrottle";

import type {
  VirtualListHandle,
  VirtualListProps,
  VirtualListStateSnapshot,
} from "./types";
import { useScaledVirtualizer } from "./use-scaled-virtualizer";
import { useVirtualListState } from "./use-virtual-list-state";
import styles from "./VirtualList.module.css";

const BOTTOM_THRESHOLD_PX = 30;
const USER_INTERACTION_WINDOW_MS = 400;
const SCROLL_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  " ",
]);
const SMOOTH_SCROLL_MAX_S = 10;
const PERSIST_DEBOUNCE_MS = 250;
const DEFAULT_ITEM_HEIGHT_PX = 400;
const MAX_CHUNK_HEIGHT = 5_000_000;

function PaddingChunks({ height, prefix }: { height: number; prefix: string }) {
  if (height <= 0) return null;
  const chunks: ReactNode[] = [];
  let remaining = height;
  let i = 0;
  while (remaining > 0) {
    const h = Math.min(remaining, MAX_CHUNK_HEIGHT);
    chunks.push(<div key={`${prefix}-${i}`} style={{ height: h }} />);
    remaining -= h;
    i++;
  }
  return <>{chunks}</>;
}

// Count occurrences of `lowerTerm` across pre-lowercased per-item text
// arrays. Lifted out of the component so the hot find-counter path is
// unit-testable and the lowercasing happens once (in the memo below) rather
// than on every keystroke. `lowerTerm` must already be lowercased.
export const countMatchesInTexts = (
  lowerTextsByItem: string[][],
  lowerTerm: string
): number => {
  // An empty term makes indexOf return its start position forever (pos += 0),
  // so guard before the scan loop — this helper is exported and unit-tested
  // directly, where the FindBand caller's own empty-term guard would not apply.
  if (lowerTerm.length === 0) {
    return 0;
  }
  let total = 0;
  for (const texts of lowerTextsByItem) {
    for (const lowerText of texts) {
      let pos = 0;
      while ((pos = lowerText.indexOf(lowerTerm, pos)) !== -1) {
        total++;
        pos += lowerTerm.length;
      }
    }
  }
  return total;
};

export function VirtualList<T>({
  persistenceKey,
  ref,
  className,
  scrollRef: externalScrollRef,
  data,
  renderRow,
  live,
  showProgress,
  initialIndex,
  scrollPaddingStart,
  components,
  smoothScroll = true,
  itemSearchText,
  findScope = "local",
  scrollToTopOnFinish = false,
  onVisibleRangeChange,
}: VirtualListProps<T> & { ref?: Ref<VirtualListHandle> }) {
  // Resolve externalScrollRef into state so TanStack gets a non-null
  // scroll element even when the ref target mounts after us. Without
  // this, the first trackpad swipe goes to the wrong scroll ancestor.
  const internalScrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollParent, setScrollParent] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!externalScrollRef) return;
    const sync = () => {
      setScrollParent((prev) =>
        prev === externalScrollRef.current
          ? prev
          : (externalScrollRef.current ?? null)
      );
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [externalScrollRef]);
  const getScrollElement = useCallback(
    () => scrollParent ?? internalScrollRef.current,
    [scrollParent]
  );

  const { virtualizer, scale, spacerHeight, toContentScroll, toSpacerScroll } =
    useScaledVirtualizer({
      count: data.length,
      estimateSize: () => DEFAULT_ITEM_HEIGHT_PX,
      getScrollElement,
      // Consumer-supplied offset for scroll-to-index landings (e.g. to clear
      // sticky chrome). A stable virtualizer option rather than a post-scroll
      // `scrollTop +=`, so tanstack's reconcile re-applies it through
      // getOffsetForIndex every frame instead of erasing it on far jumps.
      scrollPaddingStart: scrollPaddingStart ?? 0,
    });

  const { getRestoreSnapshot, recordSnapshot } =
    useVirtualListState(persistenceKey);

  const [followOutput, setFollowOutput] = useProperty<boolean | null>(
    persistenceKey,
    "follow",
    { defaultValue: null }
  );
  const isAutoScrollingRef = useRef(false);

  // Follow is toggled ONLY by user-initiated scrolling. Programmatic
  // auto-follow scrolls and content-growth reflow also emit scroll events, but
  // inferring user intent from scroll-position deltas is unreliable while the
  // bottom is a moving target during streaming. So we instead gate on real
  // input events (wheel / touch / pointer-drag / scroll keys).
  const userInteractingRef = useRef(false);
  const pointerDownRef = useRef(false);
  const interactTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteUserInteraction = useCallback(() => {
    userInteractingRef.current = true;
    if (interactTimerRef.current) clearTimeout(interactTimerRef.current);
    interactTimerRef.current = setTimeout(() => {
      userInteractingRef.current = false;
    }, USER_INTERACTION_WINDOW_MS);
  }, []);

  useEffect(() => {
    if (followOutput === null) setFollowOutput(!!live);
  }, [followOutput, live, setFollowOutput]);

  const prevLive = usePreviousValue(live);
  useEffect(() => {
    if (scrollToTopOnFinish && !live && prevLive && followOutput) {
      const el = getScrollElement();
      if (el) {
        setFollowOutput(false);
        setTimeout(() => el.scrollTo({ top: 0, behavior: "auto" }), 100);
      }
    }
  }, [
    live,
    prevLive,
    followOutput,
    scrollToTopOnFinish,
    getScrollElement,
    setFollowOutput,
  ]);

  const handleScroll = useRafThrottle(() => {
    if (!live) return;
    const el = getScrollElement();
    if (!el) return;
    // Ignore scroll events not caused by user input (programmatic auto-follow,
    // content-growth reflow) — they must never flip follow state.
    if (!userInteractingRef.current && !pointerDownRef.current) return;
    const atBottom =
      el.scrollHeight - el.scrollTop <= el.clientHeight + BOTTOM_THRESHOLD_PX;
    if (atBottom && !followOutput) setFollowOutput(true);
    else if (!atBottom && followOutput) setFollowOutput(false);
  });

  useEffect(() => {
    const el = getScrollElement();
    if (!el) return;
    el.addEventListener("scroll", handleScroll);
    return () => el.removeEventListener("scroll", handleScroll);
  }, [getScrollElement, handleScroll]);

  useEffect(() => {
    const el = getScrollElement();
    if (!el) return;
    const onWheel = () => noteUserInteraction();
    const onTouchMove = () => noteUserInteraction();
    const onKeyDown = (e: KeyboardEvent) => {
      if (SCROLL_KEYS.has(e.key)) noteUserInteraction();
    };
    const onPointerDown = () => {
      pointerDownRef.current = true;
      noteUserInteraction();
    };
    const onPointerUp = () => {
      pointerDownRef.current = false;
    };
    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("keydown", onKeyDown);
    el.addEventListener("pointerdown", onPointerDown, { passive: true });
    window.addEventListener("pointerup", onPointerUp, { passive: true });
    window.addEventListener("pointercancel", onPointerUp, { passive: true });
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("keydown", onKeyDown);
      el.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [getScrollElement, noteUserInteraction]);

  const contentTotal = virtualizer.getTotalSize();
  useEffect(() => {
    if (!followOutput || !live) return;
    const el = getScrollElement();
    if (!el) return;
    requestAnimationFrame(() => {
      isAutoScrollingRef.current = true;
      el.scrollTo({ top: el.scrollHeight });
      lastAutoScrollTopRef.current = el.scrollTop;
      requestAnimationFrame(() => {
        isAutoScrollingRef.current = false;
      });
    });
  }, [contentTotal, followOutput, live, getScrollElement]);

  // Re-arm the one-shot initial-scroll when the persistence key changes
  // (e.g., user switches to a different sample). Without this, the
  // scroll container — which may be owned by the parent and not unmount —
  // keeps the previous sample's scrollTop.
  const hasInitialScrolledRef = useRef(false);
  // Whether the user has scrolled this list since (re)mount. Used to gate the
  // restore: the scroll container may be shared across views (e.g. transcript
  // vs messages tabs), so on a fresh mount it can carry another view's
  // scrollTop. We must not treat that foreign offset as "the user scrolled".
  const userScrolledRef = useRef(false);
  // The scrollTop we last set programmatically (restore / auto-follow). Scroll
  // events echoing that value are ignored so a restore isn't mistaken for a
  // user scroll and re-persisted — which would otherwise drift the saved
  // position on every tab flip.
  const lastAutoScrollTopRef = useRef<number | null>(null);
  const lastInitialKeyRef = useRef<string | null>(null);
  const lastInitialIndexRef = useRef<number | undefined>(undefined);
  // The no-snapshot "reset to top" is a one-shot per (re)key: without this the
  // effect re-fires on every `contentTotal` change (item measurement) and keeps
  // slamming scrollTop back to 0, fighting an imperative deep-link scroll on the
  // same (shared) container until that scroll's settle loop gives up. WebKit's
  // rAF ordering loses that race every time. Re-armed alongside the key below.
  const hasResetTopRef = useRef(false);
  useEffect(() => {
    if (
      lastInitialKeyRef.current !== persistenceKey ||
      lastInitialIndexRef.current !== initialIndex
    ) {
      hasInitialScrolledRef.current = false;
      userScrolledRef.current = false;
      hasResetTopRef.current = false;
      lastInitialKeyRef.current = persistenceKey;
      lastInitialIndexRef.current = initialIndex ?? undefined;
    }
    if (hasInitialScrolledRef.current) return;
    const el = getScrollElement();
    if (!el) return;
    const snapshot = getRestoreSnapshot();
    requestAnimationFrame(() => {
      // Flag programmatic scrolls so the scroll listeners don't mistake them
      // for user scrolls (which would block restore / persist a bogus offset).
      isAutoScrollingRef.current = true;
      // Release the guard a frame after the last programmatic scroll.
      const release = () => {
        lastAutoScrollTopRef.current = el.scrollTop;
        requestAnimationFrame(() => {
          isAutoScrollingRef.current = false;
        });
      };
      if (initialIndex != null) {
        // Explicit navigation target (e.g., message deep link) always
        // takes priority over persisted scroll state.
        // scrollPaddingStart (set on the virtualizer) reserves the sticky-chrome
        // height here too, so the mount-time deep link lands like a runtime jump.
        virtualizer.scrollToIndex(initialIndex, {
          align: "start",
          behavior: "auto",
        });
        hasInitialScrolledRef.current = true;
        release();
      } else if (followOutput && live) {
        // Auto-following a live sample: the follow effect owns the scroll
        // position (pins to bottom). Commit the one-shot guard so this effect
        // stops re-firing and resetting scrollTop to 0 on every new event —
        // which would otherwise fight follow until the user scrolled manually.
        hasInitialScrolledRef.current = true;
        release();
      } else if (snapshot) {
        // Restore from snapshot unless the user has already scrolled this
        // list (e.g. snapshot rehydrated late and they reached for the wheel
        // before it arrived — don't fight them). A foreign scrollTop from a
        // shared container is NOT a user scroll, so it doesn't block restore.
        hasInitialScrolledRef.current = true;
        if (!userScrolledRef.current) {
          const maxScroll = Math.max(
            0,
            virtualizer.getTotalSize() - el.clientHeight
          );
          const offset =
            snapshot.totalCount === data.length
              ? snapshot.scrollOffset
              : Math.min(snapshot.scrollOffset, maxScroll);
          el.scrollTop = toSpacerScroll(offset);
        }
        release();
      } else if (!userScrolledRef.current && !hasResetTopRef.current) {
        // No snapshot: start at the top once, clearing any offset carried over
        // from another view sharing this scroll container. Don't commit the
        // one-shot guard (the effect re-fires if a snapshot rehydrates later),
        // but flag the reset so subsequent re-fires don't keep forcing 0 and
        // fight an imperative deep-link scroll on this shared container.
        el.scrollTop = 0;
        hasResetTopRef.current = true;
        release();
      } else {
        release();
      }
    });
  }, [
    persistenceKey,
    initialIndex,
    contentTotal,
    data.length,
    followOutput,
    live,
    getRestoreSnapshot,
    getScrollElement,
    toSpacerScroll,
    virtualizer,
  ]);

  const buildSnapshot = useCallback(
    (el: HTMLElement): VirtualListStateSnapshot => ({
      version: 1,
      scrollOffset: toContentScroll(el.scrollTop),
      totalCount: data.length,
    }),
    [toContentScroll, data.length]
  );

  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistOnScroll = useRafThrottle(() => {
    if (isAutoScrollingRef.current) return;
    const elNow = getScrollElement();
    // Ignore the scroll event echoed by a programmatic scroll (restore /
    // auto-follow) — it isn't a user scroll, and persisting it would drift the
    // saved position across tab flips.
    if (
      elNow &&
      lastAutoScrollTopRef.current !== null &&
      Math.abs(elNow.scrollTop - lastAutoScrollTopRef.current) <= 2
    ) {
      return;
    }
    userScrolledRef.current = true;
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      const el = getScrollElement();
      if (!el) return;
      recordSnapshot(buildSnapshot(el));
    }, PERSIST_DEBOUNCE_MS);
  });

  useEffect(() => {
    const el = getScrollElement();
    if (!el) return;
    el.addEventListener("scroll", persistOnScroll);
    return () => el.removeEventListener("scroll", persistOnScroll);
  }, [getScrollElement, persistOnScroll]);

  // Cancel any pending debounced save on unmount. Without this a queued timer
  // fires after the list unmounts and reads the (shared) container at the next
  // tab's scrollTop, persisting a bogus offset under this list's key.
  useEffect(
    () => () => {
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
      if (interactTimerRef.current) {
        clearTimeout(interactTimerRef.current);
        interactTimerRef.current = null;
      }
    },
    []
  );

  const items = virtualizer.getVirtualItems();
  const startIndex = items[0]?.index ?? 0;
  const endIndex = items[items.length - 1]?.index ?? 0;
  const visibleRangeRef = useRef({ startIndex: 0, endIndex: 0 });
  useEffect(() => {
    const range = { startIndex, endIndex };
    visibleRangeRef.current = range;
    onVisibleRangeChange?.(range);
  }, [startIndex, endIndex, onVisibleRangeChange]);

  useImperativeHandle(
    ref,
    (): VirtualListHandle => ({
      scrollToIndex(opts) {
        const behavior =
          scale > SMOOTH_SCROLL_MAX_S
            ? "auto"
            : (opts.behavior ?? (smoothScroll ? "smooth" : "auto"));
        // The sticky-chrome offset is applied via the virtualizer's
        // scrollPaddingStart option (see useScaledVirtualizer above), so it
        // survives reconcile — nothing to nudge here.
        virtualizer.scrollToIndex(opts.index, {
          align: opts.align,
          behavior,
        });
      },
      scrollTo(opts) {
        const el = getScrollElement();
        if (!el) return;
        const behavior =
          scale > SMOOTH_SCROLL_MAX_S
            ? "auto"
            : (opts.behavior ?? (smoothScroll ? "smooth" : "auto"));
        el.scrollTo({ top: opts.top, behavior });
      },
      getState(callback) {
        const el = getScrollElement();
        callback({
          version: 1,
          scrollOffset: el ? toContentScroll(el.scrollTop) : 0,
          totalCount: data.length,
        });
      },
      jumpToStart() {
        const el = getScrollElement();
        if (el) el.scrollTop = 0;
      },
      jumpToEnd() {
        const el = getScrollElement();
        if (el) el.scrollTop = spacerHeight;
      },
    }),
    [
      virtualizer,
      scale,
      spacerHeight,
      smoothScroll,
      getScrollElement,
      toContentScroll,
      data.length,
    ]
  );

  const { registerVirtualList, registerMatchCounter } = useExtendedFind();
  const searchInData = useCallback<ExtendedFindFn>(
    (term, direction, onContentReady) => {
      if (!term || data.length === 0) return Promise.resolve(false);
      const isForward = direction === "forward";
      const len = data.length;
      const range = visibleRangeRef.current;
      const current = isForward ? range.endIndex : range.startIndex;
      const getText = itemSearchText ?? ((item: T) => JSON.stringify(item));
      const prepared = prepareSearchTerm(term);
      for (let offset = 1; offset < len; offset++) {
        const i = isForward
          ? (current + offset) % len
          : (current - offset + len) % len;
        const item = data[i];
        if (item === undefined) continue;
        const texts = getText(item);
        const textArray = Array.isArray(texts) ? texts : [texts];
        const hit = textArray.some((text) => {
          const lower = text.toLowerCase();
          if (lower.includes(prepared.simple)) return true;
          if (prepared.unquoted && lower.includes(prepared.unquoted))
            return true;
          if (prepared.jsonEscaped && lower.includes(prepared.jsonEscaped))
            return true;
          return false;
        });
        if (hit) {
          virtualizer.scrollToIndex(i, { align: "center" });
          setTimeout(onContentReady, 200);
          return Promise.resolve(true);
        }
      }
      return Promise.resolve(false);
    },
    [data, itemSearchText, virtualizer]
  );

  // Pre-compute lowercased search text for every item once per data /
  // accessor change, so the FindBand counter doesn't re-extract and
  // re-lowercase the whole list on each keystroke.
  const precomputedSearchTexts = useMemo(() => {
    const getText = itemSearchText ?? ((item: T) => JSON.stringify(item));
    return data.map((item) => {
      const texts = getText(item);
      const textArray = Array.isArray(texts) ? texts : [texts];
      return textArray.map((t) => t.toLowerCase());
    });
  }, [data, itemSearchText]);

  const countMatchesInData = useCallback<ExtendedCountFn>(
    (term) => {
      if (!term || precomputedSearchTexts.length === 0) return 0;
      return countMatchesInTexts(precomputedSearchTexts, term.toLowerCase());
    },
    [precomputedSearchTexts]
  );

  useEffect(() => {
    if (findScope === "none") return;
    const u1 = registerVirtualList(persistenceKey, searchInData);
    const u2 = registerMatchCounter(persistenceKey, countMatchesInData);
    return () => {
      u1();
      u2();
    };
  }, [
    findScope,
    persistenceKey,
    registerVirtualList,
    registerMatchCounter,
    searchInData,
    countMatchesInData,
  ]);

  const ItemSlot = components?.Item;
  const FooterSlot = components?.Footer;
  const ownsScroll = !externalScrollRef;

  // TanStack works in content space (via intercepted scroll offset).
  // Padding divs are in SPACER space (divided by scale) so no single
  // element exceeds the browser's max height cap (~17M Firefox).
  // The rendered band stays in content space (natural item heights).
  const firstItem = items.length > 0 ? items[0] : undefined;
  const lastItem = items.length > 0 ? items[items.length - 1] : undefined;
  const topPaddingContent = firstItem?.start ?? 0;
  const topPaddingSpacer = topPaddingContent / scale;
  const renderedBandHeight =
    firstItem && lastItem
      ? lastItem.start + lastItem.size - firstItem.start
      : 0;
  const bottomPaddingContent = lastItem
    ? Math.max(0, virtualizer.getTotalSize() - (lastItem.start + lastItem.size))
    : virtualizer.getTotalSize();
  const bottomPaddingSpacer = bottomPaddingContent / scale;

  return (
    <div
      ref={(el) => {
        if (!ownsScroll) return;
        internalScrollRef.current = el;
        // Push the mounted element into state so getScrollElement gets a
        // fresh identity and TanStack re-polls — without this, the first
        // render passes a null scroll element and TanStack caches that.
        setScrollParent((prev) => (prev === el ? prev : el));
      }}
      className={clsx(styles.scroller, className)}
      style={
        ownsScroll
          ? { height: "100%", width: "100%", overflow: "auto" }
          : { width: "100%" }
      }
    >
      <PaddingChunks height={topPaddingSpacer} prefix="top" />
      <div style={{ position: "relative", height: renderedBandHeight }}>
        {items.map((vItem) => {
          const item = data[vItem.index];
          if (item === undefined) return null;
          const top = vItem.start - topPaddingContent;
          const child = renderRow(vItem.index, item);
          if (ItemSlot) {
            return (
              <div
                key={vItem.key}
                ref={virtualizer.measureElement}
                data-index={vItem.index}
                style={{ position: "absolute", top, left: 0, right: 0 }}
              >
                <ItemSlot
                  data-index={vItem.index}
                  data-item-index={vItem.index}
                  data-known-size={vItem.size}
                  style={{}}
                >
                  {child}
                </ItemSlot>
              </div>
            );
          }
          return (
            <div
              key={vItem.key}
              ref={virtualizer.measureElement}
              data-index={vItem.index}
              data-item-index={vItem.index}
              data-known-size={vItem.size}
              style={{ position: "absolute", top, left: 0, right: 0 }}
            >
              {child}
            </div>
          );
        })}
      </div>
      <PaddingChunks height={bottomPaddingSpacer} prefix="bot" />
      {showProgress &&
        (FooterSlot ? (
          <FooterSlot />
        ) : (
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              padding: "1rem",
            }}
          >
            <PulsingDots subtle={false} size="medium" />
          </div>
        ))}
    </div>
  );
}
