import clsx from "clsx";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
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
  type FindDirection,
  type MatchLocatorFn,
} from "../components/ExtendedFindContext";
import { prepareSearchTerm } from "../components/prepareSearchTerm";
import { PulsingDots } from "../components/PulsingDots";
import { SCROLL_RELEASE_KEYS as SCROLL_KEYS } from "../hooks/useChromeNavOwnership";
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

// Lifted out of the component so the hot find-counter path is unit-testable
// and lowercasing happens once, not per keystroke; `lowerTerm` pre-lowercased.
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

/**
 * Index of the next item matching any of `lowerVariants`, scanning from `from`
 * in `direction` and wrapping once.
 *
 * `from` is the item the find session is standing on, NOT a viewport bound —
 * see `findScanOrigin` for how it is chosen and when the viewport seeds it.
 *
 * The final step revisits `from` itself, so a list whose only match is the
 * current item re-finds that item — letting `window.find` walk the occurrences
 * inside it — instead of reporting no match.
 */
export const nextMatchingItem = (
  lowerTextsByItem: string[][],
  lowerVariants: string[],
  from: number,
  isForward: boolean
): number | null => {
  const len = lowerTextsByItem.length;
  const variants = lowerVariants.filter((v) => v.length > 0);
  if (len === 0 || variants.length === 0) return null;
  for (let offset = 1; offset <= len; offset++) {
    const raw = isForward ? from + offset : from - offset;
    const i = ((raw % len) + len) % len;
    const texts = lowerTextsByItem[i];
    if (texts === undefined) continue;
    if (texts.some((t) => variants.some((v) => t.includes(v)))) return i;
  }
  return null;
};

/** The match a find session is standing on, tagged with the session it belongs to. */
export interface FindCursor {
  term: string;
  index: number;
  session: number;
}

/**
 * Where the next scan starts.
 *
 * The find session's own cursor wins whenever it addresses the current term
 * and data. Reading the viewport on every press is the defect this replaces:
 * `visibleRangeRef` is written in a post-render effect while `onContentReady`
 * fires on a fixed timer, so a press arriving before the commit rescanned from
 * the same origin and returned the same item — find plateaued on a subset of
 * the corpus and never reached the rest, while the counter kept climbing.
 *
 * The viewport still seeds a first press, and deliberately from the trailing
 * edge of the rendered window: this path only runs once `window.find` has
 * exhausted the rendered DOM, so every on-screen match has already been
 * walked and starting inside the window would re-cover it.
 *
 * A cursor is only trusted within the find session that created it. The find
 * band unmounts on Escape but the list does not, so the cursor outlives it:
 * without the session check, closing find at item 400, scrolling back to the
 * top and searching the same term again would resume at 401 and leave
 * everything in between unreachable. Session identity is the right test here
 * rather than proximity to the viewport — the viewport is precisely the
 * signal the cursor exists to stop trusting, so validating one against the
 * other would reject a good cursor after a long jump and saw back and forth.
 */
export const findScanOrigin = (
  cursor: FindCursor | null,
  term: string,
  sessionId: number,
  itemCount: number,
  isForward: boolean,
  range: { startIndex: number; endIndex: number }
): number => {
  if (
    cursor &&
    cursor.term === term &&
    cursor.session === sessionId &&
    cursor.index < itemCount
  ) {
    return cursor.index;
  }
  return isForward ? range.endIndex : range.startIndex;
};

/**
 * Whether a selection observed at `itemIndex` should move the find cursor.
 *
 * Only ever with the direction of travel. `window.find` restarts from the top
 * of the rendered DOM whenever it cannot advance, so an unguarded update drags
 * the cursor back to a row already passed — and if the scroll to the next
 * match never commits (its row stays unrendered), that pins the cursor and
 * find deadlocks on a single row. Measured on a 1,700-row chat: without this
 * the walk stalls at row 1705 and never reaches the rest of the list; with it,
 * 80 presses reach 29 rows instead of 13.
 *
 * A different term means a new walk, so anything is an advance.
 */
export const cursorAdvances = (
  cursor: FindCursor | null,
  term: string,
  itemIndex: number,
  direction: FindDirection
): boolean => {
  if (!cursor || cursor.term !== term) return true;
  return direction === "forward"
    ? itemIndex > cursor.index
    : itemIndex < cursor.index;
};

/**
 * 0-based ordinal of one occurrence across the whole list, counting in item
 * order — the same enumeration `countMatchesInTexts` totals, so the result
 * indexes into the count the find band displays.
 *
 * `occurrenceWithinItem` is observed in the RENDERED row, while the count is
 * taken from the row's search text, and the two need not agree: a chat row
 * renders its role as literal text above content that `itemSearchText` alone
 * contributes, so the DOM can hold occurrences the total does not know about.
 * Returns null rather than an ordinal the total cannot contain — reporting one
 * would render "2 of 1".
 */
export const occurrenceOrdinal = (
  lowerTextsByItem: string[][],
  lowerTerm: string,
  itemIndex: number,
  occurrenceWithinItem: number
): number | null => {
  const itemTexts = lowerTextsByItem[itemIndex];
  if (itemTexts === undefined) return null;
  if (occurrenceWithinItem >= countMatchesInTexts([itemTexts], lowerTerm)) {
    return null;
  }
  return (
    countMatchesInTexts(lowerTextsByItem.slice(0, itemIndex), lowerTerm) +
    occurrenceWithinItem
  );
};

/**
 * Locate the document selection inside `root`: which rendered row holds it,
 * and how many occurrences of `lowerTerm` precede it within that row.
 *
 * Rows carry `data-item-index`, so the item index survives virtualization —
 * only rendered rows can hold a selection anyway. Scoped to `root` so a list
 * never claims a selection belonging to another list mounted alongside it.
 *
 * Returns null when there is no selection, it lies outside `root`, or it is
 * not inside a row.
 */
export const itemOccurrenceAtSelection = (
  root: Element | null,
  lowerTerm: string
): { itemIndex: number; occurrence: number } | null => {
  if (typeof window === "undefined" || !root || lowerTerm.length === 0) {
    return null;
  }
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer)) return null;

  let el: Element | null =
    range.startContainer.nodeType === Node.ELEMENT_NODE
      ? (range.startContainer as Element)
      : range.startContainer.parentElement;
  while (el && el !== root && !el.hasAttribute("data-item-index")) {
    el = el.parentElement;
  }
  if (!el || el === root) return null;
  const itemIndex = Number(el.getAttribute("data-item-index"));
  if (!Number.isInteger(itemIndex) || itemIndex < 0) return null;

  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let occurrence = 0;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const textNode = node as Text;
    const atSelection = textNode === range.startContainer;
    const hay = (
      atSelection ? textNode.data.slice(0, range.startOffset) : textNode.data
    ).toLowerCase();
    let pos = 0;
    while ((pos = hay.indexOf(lowerTerm, pos)) !== -1) {
      occurrence++;
      pos += lowerTerm.length;
    }
    if (atSelection) break;
  }
  return { itemIndex, occurrence };
};

export function VirtualList<T>({
  persistenceKey,
  ref,
  className,
  scrollRef: externalScrollRef,
  data,
  renderRow,
  live,
  navOwned,
  followRequested,
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
  // The list's own root, so the match locator can reject a selection that
  // belongs to a different list mounted alongside this one. Tracked
  // separately from internalScrollRef, which is only set when this list owns
  // its scroller.
  const rootRef = useRef<HTMLDivElement | null>(null);
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

  const { virtualizer, scale, toContentScroll, toSpacerScroll } =
    useScaledVirtualizer({
      count: data.length,
      estimateSize: () => DEFAULT_ITEM_HEIGHT_PX,
      getScrollElement,
      // A stable virtualizer option rather than a post-scroll `scrollTop +=`,
      // so tanstack's reconcile re-applies it instead of erasing it on far jumps.
      scrollPaddingStart: scrollPaddingStart ?? 0,
    });

  const { getRestoreSnapshot, recordSnapshot } =
    useVirtualListState(persistenceKey);

  const [storedFollow, setFollowOutput] = useProperty<boolean | null>(
    persistenceKey,
    "follow",
    { defaultValue: null }
  );
  const isAutoScrollingRef = useRef(false);

  // Whether the user has explicitly toggled follow (via a real scroll) since
  // this key mounted — blocks the live false→true re-arm from overriding a
  // deliberate scroll-away. Read/written only in effects and handlers.
  const followUserActedRef = useRef(false);
  // The follow value THIS component's seed last wrote to the store. A stored
  // value still equal to it is the seed's own (provisional) write — not a user
  // or nav decision — so the live-flip re-arm may arm past it without
  // clobbering a genuinely persisted choice.
  const followSeedRef = useRef<boolean | null>(null);

  // Resolve the EFFECTIVE initial follow for a (re)mount / key change. The store
  // is the single source of truth (seeded here, then driven only by explicit
  // acts: scroll-to-tail, step-past-last arm, `follow=1`), but a persisted
  // `true` it carries must NEVER reach render or the auto-follow effect on a
  // nav-owned mount — otherwise it yanks the deep-link landing to the tail. So
  // we OVERLAY the resolved value (via `followSeed`) until it is written through
  // to the store (the layout effect below, before paint).
  const resolveInitialFollow = (): boolean =>
    followRequested
      ? // Explicit follow=1 URL param arms regardless of nav ownership.
        true
      : navOwned
        ? // Nav-owned (deep-link / exit-focus) mount owns the landing: stand
          // down even against a persisted true, and never auto-arm from live.
          false
        : // Fresh mount: tail a live sample from the start (main's behavior),
          // otherwise honor any persisted state.
          (storedFollow ?? !!live);
  // Seed state, all transitions via React's sanctioned setState-during-render
  // (re-renders before committing, so intermediate values never reach an
  // effect — and no refs are read during render). Reset on key change; once the
  // store reflects the seed, `applied` flips and the store alone drives
  // followOutput (a later scroll-away must not re-engage the override).
  const [followSeed, setFollowSeed] = useState<{
    key: string;
    value: boolean;
    applied: boolean;
  }>(() => ({
    key: persistenceKey,
    value: resolveInitialFollow(),
    applied: false,
  }));
  if (followSeed.key !== persistenceKey) {
    setFollowSeed({
      key: persistenceKey,
      value: resolveInitialFollow(),
      applied: false,
    });
  } else if (!followSeed.applied && storedFollow === followSeed.value) {
    // Store now matches the seed: hand ownership to the store.
    setFollowSeed((s) => ({ ...s, applied: true }));
  }
  const seedActive = followSeed.key === persistenceKey && !followSeed.applied;
  const followOutput: boolean = seedActive
    ? followSeed.value
    : (storedFollow ?? false);
  // New key: clear per-mount follow ownership BEFORE the seed-write effect
  // below (layout effects run in declaration order) so a stale seed-write
  // marker or user-act flag from the previous sample can't leak across.
  useLayoutEffect(() => {
    followUserActedRef.current = false;
    followSeedRef.current = null;
  }, [persistenceKey]);
  // Write the seed through to the store (an external system, so this is a
  // permitted effect side-effect) before paint, so the store — the single
  // source of truth the f-follow wrapper reads — is corrected promptly.
  useLayoutEffect(() => {
    if (seedActive && storedFollow !== followSeed.value) {
      setFollowOutput(followSeed.value);
      // Record our own write so the live-flip re-arm can tell it apart from a
      // genuinely persisted or user-set value.
      followSeedRef.current = followSeed.value;
    }
  }, [seedActive, followSeed, storedFollow, setFollowOutput]);

  // Follow toggles ONLY on real input events (wheel/touch/drag/keys):
  // inferring intent from scroll deltas is unreliable while streaming moves
  // the bottom.
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

  const prevLive = usePreviousValue(live);
  // A sample that only started streaming AFTER mount (live flips false→true —
  // data can load a frame or two late) must still tail from the start, like a
  // mount that was live from the first render. The seed resolved follow=false
  // under the not-yet-live sample and wrote it through; re-arm here, but only
  // while that stored false is still the seed's OWN provisional write and no
  // explicit user scroll or nav landing has since taken ownership.
  useEffect(() => {
    if (
      live &&
      !prevLive &&
      !navOwned &&
      !followRequested &&
      !followUserActedRef.current &&
      !storedFollow &&
      storedFollow === followSeedRef.current
    ) {
      setFollowOutput(true);
      followSeedRef.current = true;
    }
  }, [
    live,
    prevLive,
    navOwned,
    followRequested,
    storedFollow,
    setFollowOutput,
  ]);
  const finishScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  // Read (not depend on) followOutput below: the finish effect flips it, and
  // a dependency would make the cleanup cancel the timer it just scheduled.
  const followOutputRef = useRef(followOutput);
  // Mirror BEFORE the finish effect below: effects run in declaration order,
  // so the finish effect always reads the value from its own commit.
  useEffect(() => {
    followOutputRef.current = followOutput;
  }, [followOutput]);
  useEffect(() => {
    if (scrollToTopOnFinish && !live && prevLive && followOutputRef.current) {
      const el = getScrollElement();
      if (el) {
        setFollowOutput(false);
        finishScrollTimerRef.current = setTimeout(() => {
          finishScrollTimerRef.current = null;
          // Re-check at fire time: user input in the interim means the user
          // has taken over, and this stale jump-to-top must not override them.
          if (!userInteractingRef.current && !pointerDownRef.current)
            el.scrollTo({ top: 0, behavior: "auto" });
        }, 100);
      }
    }
    // Cancelled on re-run (live restarts) and unmount: the scroll container
    // is often owned by the parent and shared across views, so a timer
    // surviving this list would scroll the NEXT view to top.
    return () => {
      if (finishScrollTimerRef.current) {
        clearTimeout(finishScrollTimerRef.current);
        finishScrollTimerRef.current = null;
      }
    };
  }, [live, prevLive, scrollToTopOnFinish, getScrollElement, setFollowOutput]);

  const handleScroll = useRafThrottle(() => {
    if (!live) return;
    const el = getScrollElement();
    if (!el) return;
    // Ignore scroll events not caused by user input (programmatic auto-follow,
    // content-growth reflow) — they must never flip follow state.
    if (!userInteractingRef.current && !pointerDownRef.current) return;
    const atBottom =
      el.scrollHeight - el.scrollTop <= el.clientHeight + BOTTOM_THRESHOLD_PX;
    // Either toggle is a deliberate user act — record it so a late live flip
    // never re-arms follow behind the user's back.
    if (atBottom && !followOutput) {
      followUserActedRef.current = true;
      setFollowOutput(true);
    } else if (!atBottom && followOutput) {
      followUserActedRef.current = true;
      setFollowOutput(false);
    }
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
    // Cancelled on cleanup — a newer follow supersedes a pending one, and a
    // frame surviving unmount would scroll the shared container to the bottom
    // of whatever view owns it next.
    let releaseFrame = 0;
    const frame = requestAnimationFrame(() => {
      isAutoScrollingRef.current = true;
      el.scrollTo({ top: el.scrollHeight });
      lastAutoScrollTopRef.current = el.scrollTop;
      releaseFrame = requestAnimationFrame(() => {
        isAutoScrollingRef.current = false;
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(releaseFrame);
    };
  }, [contentTotal, followOutput, live, getScrollElement]);

  // Re-arm the one-shot initial-scroll when the persistence key changes: the
  // parent-owned scroll container keeps the previous sample's scrollTop.
  const hasInitialScrolledRef = useRef(false);
  // Whether the user scrolled this list since (re)mount — a foreign scrollTop
  // carried by a shared container must not count as "the user scrolled".
  const userScrolledRef = useRef(false);
  // The scrollTop we last set programmatically; echoing scroll events are
  // ignored so a restore isn't re-persisted, drifting the saved position.
  const lastAutoScrollTopRef = useRef<number | null>(null);

  // Re-fires scrollToIndex each frame to absorb external chrome shifts TanStack won't reconcile on its own; bounded, and real user input cancels it.
  const settleFrameRef = useRef(0);
  const releaseFrameRef = useRef(0);
  const settleScrollToIndex = useCallback(
    (
      index: number,
      align?: "start" | "center" | "end",
      onDone?: () => void
    ) => {
      const jump = () =>
        virtualizer.scrollToIndex(index, { align, behavior: "auto" });
      // Every exit path must release the auto-scroll guard (else persistence
      // stays disabled); cancel a previous settle's pending release so it
      // can't flip the guard off mid-settle.
      isAutoScrollingRef.current = true;
      cancelAnimationFrame(releaseFrameRef.current);
      const finish = () => {
        const elNow = getScrollElement();
        if (elNow) lastAutoScrollTopRef.current = elNow.scrollTop;
        releaseFrameRef.current = requestAnimationFrame(() => {
          isAutoScrollingRef.current = false;
        });
        onDone?.();
      };
      jump();
      const el = getScrollElement();
      if (!el) {
        finish();
        return;
      }
      cancelAnimationFrame(settleFrameRef.current);
      let frames = 0;
      let stable = 0;
      let lastTop = el.scrollTop;
      const settle = () => {
        if (userInteractingRef.current) {
          finish();
          return;
        }
        jump();
        stable = Math.abs(el.scrollTop - lastTop) <= 1 ? stable + 1 : 0;
        lastTop = el.scrollTop;
        if (stable < 3 && ++frames < 30) {
          settleFrameRef.current = requestAnimationFrame(settle);
        } else {
          finish();
        }
      };
      settleFrameRef.current = requestAnimationFrame(settle);
    },
    [virtualizer, getScrollElement]
  );
  useEffect(
    () => () => {
      cancelAnimationFrame(settleFrameRef.current);
      cancelAnimationFrame(releaseFrameRef.current);
    },
    []
  );
  const lastInitialKeyRef = useRef<string | null>(null);
  // Restore a persisted pixel offset by RE-FORCING it until the virtualizer's
  // re-measure compensation goes quiet. A one-shot write races the remount
  // measurement pass: every row measured after the write that sits entirely
  // above the fold shifts scrollTop by its estimate error (see
  // shouldAdjustScrollPositionOnItemSizeChange), and which rows land after
  // the write depends on re-render timing — virtual-core 3.17.7 moved that
  // timing (notify(adjustedSync) -> flushSync) and drifted the restore by a
  // full row (#519). Re-forcing until quiet makes the landing independent of
  // when re-renders happen; it also absorbs the browser clamping an early
  // write against a not-yet-grown (estimate-sized) scrollHeight. The target
  // is a callback so per-frame writes see fresh clamp bounds — and, via the
  // ref-backed converters, a fresh scale — as totals grow.
  const settleRestoreScroll = useCallback(
    (getTargetSpacerTop: () => number) => {
      // Guard bookkeeping mirrors settleScrollToIndex: every exit path —
      // including a missing scroll element — must book the guard release, or
      // the caller-taken auto-scroll guard leaks and persistence stays
      // silently dead for the rest of the mount.
      isAutoScrollingRef.current = true;
      cancelAnimationFrame(releaseFrameRef.current);
      cancelAnimationFrame(settleFrameRef.current);
      const el = getScrollElement();
      const keyAtStart = lastInitialKeyRef.current;
      const finish = () => {
        if (el) lastAutoScrollTopRef.current = el.scrollTop;
        releaseFrameRef.current = requestAnimationFrame(() => {
          isAutoScrollingRef.current = false;
        });
      };
      if (!el) {
        finish();
        return;
      }
      el.scrollTop = getTargetSpacerTop();
      let frames = 0;
      let stable = 0;
      let lastTop = el.scrollTop;
      const settle = () => {
        // A key change mid-settle means this restore belongs to the previous
        // sample — stop before writing its offset into the new one's list.
        // User input always wins over a pending restore.
        if (
          userInteractingRef.current ||
          lastInitialKeyRef.current !== keyAtStart
        ) {
          finish();
          return;
        }
        // Read BEFORE re-forcing: the drift being waited out (re-measure
        // compensation nudging scrollTop after our write) happens between
        // frames, and forcing first would hide it from the stability check.
        const preTop = el.scrollTop;
        el.scrollTop = getTargetSpacerTop();
        const postTop = el.scrollTop;
        // Any movement since last frame — external compensation (preTop) or
        // our own re-force landing somewhere new (clamp released as content
        // grew, postTop) — means the layout is still moving.
        const moved =
          Math.abs(preTop - lastTop) > 1 || Math.abs(postTop - lastTop) > 1;
        stable = moved ? 0 : stable + 1;
        lastTop = postTop;
        if (stable < 3 && ++frames < 30) {
          settleFrameRef.current = requestAnimationFrame(settle);
        } else {
          finish();
        }
      };
      settleFrameRef.current = requestAnimationFrame(settle);
    },
    [getScrollElement]
  );
  const lastInitialIndexRef = useRef<number | undefined>(undefined);
  // The no-snapshot "reset to top" is a one-shot per (re)key: re-firing on
  // every measurement would keep slamming scrollTop to 0 against an
  // imperative deep-link scroll (WebKit loses that rAF race every time).
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
    // Cancelled on cleanup — the shared container outlives this list, and a
    // frame surviving unmount (or a key change) would scroll it under
    // whatever view owns it next, with stale closures.
    let releaseFrame = 0;
    const frame = requestAnimationFrame(() => {
      // Flag programmatic scrolls so the scroll listeners don't mistake them
      // for user scrolls (which would block restore / persist a bogus offset).
      isAutoScrollingRef.current = true;
      // Release the guard a frame after the last programmatic scroll.
      const release = () => {
        lastAutoScrollTopRef.current = el.scrollTop;
        releaseFrame = requestAnimationFrame(() => {
          isAutoScrollingRef.current = false;
        });
      };
      if (initialIndex != null) {
        // Explicit navigation target beats persisted scroll state;
        // scrollPaddingStart makes it land like a runtime jump.
        hasInitialScrolledRef.current = true;
        // settleScrollToIndex releases the auto-scroll guard itself.
        settleScrollToIndex(initialIndex, "start");
      } else if (followOutput && live) {
        // Live follow owns the scroll position: commit the one-shot guard so
        // this effect stops resetting scrollTop to 0 on every new event.
        hasInitialScrolledRef.current = true;
        release();
      } else if (snapshot) {
        // Restore unless the user already scrolled this list (don't fight the
        // wheel); a foreign scrollTop from a shared container doesn't block it.
        hasInitialScrolledRef.current = true;
        if (!userScrolledRef.current) {
          // settleRestoreScroll releases the auto-scroll guard itself.
          // Whether to clamp is decided once at restore time (one-shot
          // semantics); only the clamp BOUNDS are re-read per frame.
          const clampToMax = snapshot.totalCount !== data.length;
          settleRestoreScroll(() => {
            const target = toSpacerScroll(snapshot.scrollOffset);
            if (!clampToMax) return target;
            // Clamped fully in spacer space (dividing by the positive scale
            // distributes over min/max, so this equals the content-space clamp).
            const maxSpacerTop = Math.max(
              0,
              toSpacerScroll(virtualizer.getTotalSize()) - el.clientHeight
            );
            return Math.min(target, maxSpacerTop);
          });
        } else {
          release();
        }
      } else if (!userScrolledRef.current && !hasResetTopRef.current) {
        // No snapshot: reset to top once WITHOUT committing the one-shot
        // guard (a snapshot may rehydrate later), but flag the reset so
        // re-fires don't keep forcing 0 against a deep-link scroll.
        el.scrollTop = 0;
        hasResetTopRef.current = true;
        release();
      } else {
        release();
      }
    });
    return () => {
      cancelAnimationFrame(frame);
      if (releaseFrame) {
        cancelAnimationFrame(releaseFrame);
        // The one-shot hasInitialScrolledRef means no later run releases the
        // guard — drop it here or scroll persistence stays disabled for the
        // rest of the mount.
        isAutoScrollingRef.current = false;
      }
    };
  }, [
    persistenceKey,
    initialIndex,
    settleScrollToIndex,
    settleRestoreScroll,
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
  // The snapshot captured at scroll time, awaiting the debounced write. Kept
  // so the flush below never has to re-read the (shared) container — by
  // flush time it can already show another view's content.
  const pendingSnapshotRef = useRef<VirtualListStateSnapshot | null>(null);
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
    if (elNow) pendingSnapshotRef.current = buildSnapshot(elNow);
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      persistTimerRef.current = null;
      pendingSnapshotRef.current = null;
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

  // FLUSH (not cancel) a pending debounced save on key change/unmount, with
  // the scroll-time snapshot: cancelling loses a tab-flip inside the debounce
  // window; letting it run would persist the next tab's offset under this key.
  useEffect(
    () => () => {
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
        if (pendingSnapshotRef.current) {
          recordSnapshot(pendingSnapshotRef.current);
        }
      }
      pendingSnapshotRef.current = null;
    },
    [recordSnapshot]
  );

  useEffect(
    () => () => {
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
        if (behavior === "auto") {
          settleScrollToIndex(opts.index, opts.align, opts.onDone);
          return;
        }
        // Smooth scrolls animate over many frames — settling would fight the
        // animation, so they stay a single fire.
        virtualizer.scrollToIndex(opts.index, {
          align: opts.align,
          behavior,
        });
        opts.onDone?.();
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
        // The true container bottom, not the list's own content height — the
        // container can hold a footer/siblings below the list (matches the
        // non-virtual fallback in useListKeyboardNavigation).
        const el = getScrollElement();
        if (el) el.scrollTop = el.scrollHeight;
      },
    }),
    [
      virtualizer,
      scale,
      settleScrollToIndex,
      smoothScroll,
      getScrollElement,
      toContentScroll,
      data.length,
    ]
  );

  const {
    registerVirtualList,
    registerMatchCounter,
    registerMatchLocator,
    getFindSessionId,
  } = useExtendedFind();

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

  // The match this find session is standing on. Owned by the session rather
  // than read back from the viewport, which is what made find cycle over a
  // handful of positions: `visibleRangeRef` is the rendered window, so
  // scanning from its trailing edge skipped every match inside the window,
  // and because it is written in a post-render effect while `onContentReady`
  // fires on a fixed timer, a press landing before the commit rescanned from
  // the same origin and returned the same item.
  const findCursorRef = useRef<FindCursor | null>(null);

  // The term currently being searched. Recorded by the counter, which the
  // find band calls on every keystroke — earlier than searchInData, which
  // only runs once window.find has exhausted the rendered DOM.
  const activeFindTermRef = useRef("");
  // Direction of the walk in progress, so the listener below can tell a step
  // forward from a step back.
  const findDirectionRef = useRef<FindDirection>("forward");

  // Keep the cursor in step with window.find's own walk through the rendered
  // rows. searchInData cannot do this itself: findExtendedInDOM clears the
  // selection before delegating, so by the time it runs there is nothing to
  // read. Without this the cursor only advances on the presses that reach
  // searchInData, so the next one resumes from a row the user already walked
  // past in the DOM and find saws back and forth. (The transcript source
  // solves the same problem the same way.)
  useEffect(() => {
    if (findScope === "none" || typeof document === "undefined") return;
    const onSelectionChange = () => {
      const term = activeFindTermRef.current;
      if (!term) return;
      const sel = document.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      // Cheap pre-filter: a find result is a single text node selected to
      // exactly the term's length. Skips the expensive walk for ordinary
      // user selections (Ctrl-A over a long list would be costly).
      if (range.startContainer !== range.endContainer) return;
      if (range.endOffset - range.startOffset !== term.length) return;
      const at = itemOccurrenceAtSelection(rootRef.current, term.toLowerCase());
      if (!at) return;
      if (
        !cursorAdvances(
          findCursorRef.current,
          term,
          at.itemIndex,
          findDirectionRef.current
        )
      ) {
        return;
      }
      findCursorRef.current = {
        term,
        index: at.itemIndex,
        session: getFindSessionId(),
      };
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () =>
      document.removeEventListener("selectionchange", onSelectionChange);
  }, [findScope, getFindSessionId]);

  const searchInData = useCallback<ExtendedFindFn>(
    (term, direction, onContentReady) => {
      const len = precomputedSearchTexts.length;
      if (!term || len === 0) return Promise.resolve(false);
      const isForward = direction === "forward";
      findDirectionRef.current = direction;
      const prepared = prepareSearchTerm(term);
      const variants = [
        prepared.simple,
        ...(prepared.unquoted ? [prepared.unquoted] : []),
        ...(prepared.jsonEscaped ? [prepared.jsonEscaped] : []),
      ];

      const sessionId = getFindSessionId();
      const from = findScanOrigin(
        findCursorRef.current,
        term,
        sessionId,
        len,
        isForward,
        visibleRangeRef.current
      );
      const i = nextMatchingItem(
        precomputedSearchTexts,
        variants,
        from,
        isForward
      );
      if (i === null) return Promise.resolve(false);
      findCursorRef.current = { term, index: i, session: sessionId };
      // Starting a new settle cancels the previous landing while retaining
      // ownership of the auto-scroll guard until the find landing finishes.
      settleScrollToIndex(i, "center");
      setTimeout(onContentReady, 200);
      return Promise.resolve(true);
    },
    [precomputedSearchTexts, settleScrollToIndex, getFindSessionId]
  );

  const countMatchesInData = useCallback<ExtendedCountFn>(
    (term) => {
      activeFindTermRef.current = term;
      if (!term || precomputedSearchTexts.length === 0) return 0;
      return countMatchesInTexts(precomputedSearchTexts, term.toLowerCase());
    },
    [precomputedSearchTexts]
  );

  // Answers "which match is the selection on?" so the find band can report a
  // true ordinal here instead of counting presses. Without it the counter
  // climbs regardless of where navigation actually lands, which is what hid
  // the cycling above.
  const locateInData = useCallback<MatchLocatorFn>(
    (term) => {
      if (!term) return null;
      const lowerTerm = term.toLowerCase();
      const at = itemOccurrenceAtSelection(rootRef.current, lowerTerm);
      if (at === null) return null;
      // Declines (null) when the rendered row holds an occurrence the search
      // text does not account for; the find band then falls back to counting
      // presses for that hit rather than showing an impossible ordinal.
      return occurrenceOrdinal(
        precomputedSearchTexts,
        lowerTerm,
        at.itemIndex,
        at.occurrence
      );
    },
    [precomputedSearchTexts]
  );

  useEffect(() => {
    if (findScope === "none") return;
    const u1 = registerVirtualList(persistenceKey, searchInData);
    const u2 = registerMatchCounter(persistenceKey, countMatchesInData);
    const u3 = registerMatchLocator(persistenceKey, locateInData);
    return () => {
      u1();
      u2();
      u3();
    };
  }, [
    findScope,
    persistenceKey,
    registerVirtualList,
    registerMatchCounter,
    registerMatchLocator,
    searchInData,
    countMatchesInData,
    locateInData,
  ]);

  const ItemSlot = components?.Item;
  const FooterSlot = components?.Footer;
  const ownsScroll = !externalScrollRef;

  // Padding divs are in SPACER space (divided by scale) so no element exceeds
  // the browser's max height cap; the rendered band stays in content space.
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
        rootRef.current = el;
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
