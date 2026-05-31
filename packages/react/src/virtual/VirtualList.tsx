import clsx from "clsx";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
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
  stickyHeaderOffset,
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
    });

  const { getRestoreSnapshot, recordSnapshot } =
    useVirtualListState(persistenceKey);

  const [followOutput, setFollowOutput] = useProperty<boolean | null>(
    persistenceKey,
    "follow",
    { defaultValue: null }
  );
  const isAutoScrollingRef = useRef(false);

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
    if (isAutoScrollingRef.current) return;
    if (!live) return;
    const el = getScrollElement();
    if (!el) return;
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

  const contentTotal = virtualizer.getTotalSize();
  useEffect(() => {
    if (!followOutput || !live) return;
    const el = getScrollElement();
    if (!el) return;
    requestAnimationFrame(() => {
      isAutoScrollingRef.current = true;
      el.scrollTo({ top: el.scrollHeight });
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
  const lastInitialKeyRef = useRef<string | null>(null);
  const lastInitialIndexRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (
      lastInitialKeyRef.current !== persistenceKey ||
      lastInitialIndexRef.current !== initialIndex
    ) {
      hasInitialScrolledRef.current = false;
      lastInitialKeyRef.current = persistenceKey;
      lastInitialIndexRef.current = initialIndex ?? undefined;
    }
    if (hasInitialScrolledRef.current) return;
    const el = getScrollElement();
    if (!el) return;
    const snapshot = getRestoreSnapshot();
    requestAnimationFrame(() => {
      if (initialIndex != null) {
        // Explicit navigation target (e.g., message deep link) always
        // takes priority over persisted scroll state.
        virtualizer.scrollToIndex(initialIndex, {
          align: "start",
          behavior: "auto",
        });
        if (stickyHeaderOffset) el.scrollTop -= stickyHeaderOffset;
        hasInitialScrolledRef.current = true;
      } else if (snapshot) {
        // Restore from snapshot only if the user hasn't already
        // scrolled (e.g. snapshot rehydrated late and they reached for
        // the wheel before it arrived — don't fight them).
        if (el.scrollTop === 0) {
          if (snapshot.totalCount === data.length) {
            el.scrollTop = toSpacerScroll(snapshot.scrollOffset);
          } else {
            const maxScroll = Math.max(0, contentTotal - el.clientHeight);
            const clamped = Math.min(snapshot.scrollOffset, maxScroll);
            el.scrollTop = toSpacerScroll(clamped);
          }
        }
        hasInitialScrolledRef.current = true;
      }
      // No snapshot yet: leave scrollTop at 0 and don't commit the
      // one-shot guard. The effect re-fires when the snapshot
      // rehydrates from Zustand-persist (vscodeApi.setState backing).
    });
  }, [
    persistenceKey,
    initialIndex,
    stickyHeaderOffset,
    contentTotal,
    data.length,
    getRestoreSnapshot,
    getScrollElement,
    toSpacerScroll,
    virtualizer,
  ]);

  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistOnScroll = useRafThrottle(() => {
    if (isAutoScrollingRef.current) return;
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      const el = getScrollElement();
      if (!el) return;
      const snapshot: VirtualListStateSnapshot = {
        version: 1,
        scrollOffset: toContentScroll(el.scrollTop),
        totalCount: data.length,
      };
      recordSnapshot(snapshot);
    }, PERSIST_DEBOUNCE_MS);
  });

  useEffect(() => {
    const el = getScrollElement();
    if (!el) return;
    el.addEventListener("scroll", persistOnScroll);
    return () => el.removeEventListener("scroll", persistOnScroll);
  }, [getScrollElement, persistOnScroll]);

  const items = virtualizer.getVirtualItems();
  const startIndex = items[0]?.index ?? 0;
  const endIndex = items[items.length - 1]?.index ?? 0;
  const visibleRangeRef = useRef({ startIndex: 0, endIndex: 0 });
  useEffect(() => {
    visibleRangeRef.current = { startIndex, endIndex };
    onVisibleRangeChange?.({ startIndex, endIndex });
  }, [startIndex, endIndex, onVisibleRangeChange]);

  useImperativeHandle(
    ref,
    (): VirtualListHandle => ({
      scrollToIndex(opts) {
        const behavior =
          scale > SMOOTH_SCROLL_MAX_S
            ? "auto"
            : (opts.behavior ?? (smoothScroll ? "smooth" : "auto"));
        virtualizer.scrollToIndex(opts.index, {
          align: opts.align,
          behavior,
        });
        if (opts.offset) {
          const el = getScrollElement();
          if (el) el.scrollTop += opts.offset;
        }
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

  const countMatchesInData = useCallback<ExtendedCountFn>(
    (term) => {
      if (!term || data.length === 0) return 0;
      const getText = itemSearchText ?? ((item: T) => JSON.stringify(item));
      const lower = term.toLowerCase();
      let total = 0;
      for (const item of data) {
        const texts = getText(item);
        const textArray = Array.isArray(texts) ? texts : [texts];
        for (const text of textArray) {
          const lowerText = text.toLowerCase();
          let pos = 0;
          while ((pos = lowerText.indexOf(lower, pos)) !== -1) {
            total++;
            pos += lower.length;
          }
        }
      }
      return total;
    },
    [data, itemSearchText]
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
        if (ownsScroll) internalScrollRef.current = el;
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
