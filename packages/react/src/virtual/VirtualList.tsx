import clsx from "clsx";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  type ReactNode,
  type Ref,
} from "react";

import {
  useExtendedFind,
  type ExtendedCountFn,
  type ExtendedFindFn,
} from "../components/ExtendedFindContext";
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

type PreparedSearchTerms = {
  simple: string;
  unquoted?: string;
  jsonEscaped?: string;
};

function prepareSearchTerm(term: string): PreparedSearchTerms {
  const lower = term.toLowerCase();
  if (!term.includes('"') && !term.includes(":")) return { simple: lower };
  return {
    simple: lower,
    unquoted: lower.replace(/"/g, ""),
    jsonEscaped: lower.replace(/"/g, '\\"'),
  };
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
  const internalScrollRef = useRef<HTMLDivElement | null>(null);
  const getScrollElement = useCallback(
    () => externalScrollRef?.current ?? internalScrollRef.current,
    [externalScrollRef]
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
  useEffect(() => {
    if (lastInitialKeyRef.current !== persistenceKey) {
      hasInitialScrolledRef.current = false;
      lastInitialKeyRef.current = persistenceKey;
    }
    if (hasInitialScrolledRef.current) return;
    const el = getScrollElement();
    if (!el) return;
    const snapshot = getRestoreSnapshot();
    requestAnimationFrame(() => {
      if (snapshot) {
        if (snapshot.totalCount === data.length) {
          el.scrollTop = toSpacerScroll(snapshot.scrollOffset);
        } else {
          const maxScroll = Math.max(0, contentTotal - el.clientHeight);
          const clamped = Math.min(snapshot.scrollOffset, maxScroll);
          el.scrollTop = toSpacerScroll(clamped);
        }
      } else if (initialIndex != null) {
        virtualizer.scrollToIndex(initialIndex, {
          align: "start",
          behavior: "auto",
        });
        if (stickyHeaderOffset) el.scrollTop -= stickyHeaderOffset;
      } else {
        el.scrollTop = 0;
      }
      hasInitialScrolledRef.current = true;
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
        if (el) el.scrollTop = virtualizer.getTotalSize();
      },
    }),
    [
      virtualizer,
      scale,
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
        const hit = textArray.some((text) =>
          text.toLowerCase().includes(prepared.simple)
        );
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

  // Firefox silently zeroes element heights above ~17M px. Chunk the
  // scroll area into multiple divs so no single element exceeds the cap.
  const topPadding = items.length > 0 ? (items[0]?.start ?? 0) : 0;
  const lastItem = items.length > 0 ? items[items.length - 1] : undefined;
  const bottomPadding = lastItem
    ? Math.max(0, spacerHeight - (lastItem.start + lastItem.size))
    : spacerHeight;

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
      <PaddingChunks height={topPadding} prefix="top" />
      <div style={{ position: "relative" }}>
        {items.map((vItem) => {
          const item = data[vItem.index];
          if (item === undefined) return null;
          const top = vItem.start - topPadding;
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
      <PaddingChunks height={bottomPadding} prefix="bot" />
      {showProgress && FooterSlot && <FooterSlot />}
    </div>
  );
}
