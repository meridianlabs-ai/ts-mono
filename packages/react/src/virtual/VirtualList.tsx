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
  useExtendedFindOptional,
  type ExtendedCountFn,
  type ExtendedFindFn,
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

export function VirtualList<T>({
  persistenceKey,
  ref,
  id,
  className,
  scrollRef: externalScroll,
  data,
  renderRow,
  estimatedItemHeight = DEFAULT_ITEM_HEIGHT_PX,
  overscan,
  embedded = false,
  resetScrollOnMount: resetScrollOnMountProp,
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
  // An embedded list shares a container whose position the host owns;
  // resetting it on mount would yank the host's scroller.
  const resetScrollOnMount = resetScrollOnMountProp ?? !embedded;

  // Resolve the external scroll target into state so TanStack gets a non-null
  // scroll element even when a ref's target mounts after us. Without
  // this, the first trackpad swipe goes to the wrong scroll ancestor.
  const externalScrollRef =
    externalScroll instanceof HTMLElement ? null : (externalScroll ?? null);
  const externalScrollEl =
    externalScroll instanceof HTMLElement ? externalScroll : null;
  const internalScrollRef = useRef<HTMLDivElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [scrollParent, setScrollParent] = useState<HTMLElement | null>(null);

  // Offset of the list within an external scroll parent. Content can sit
  // above an embedded list in a shared scroller, so item coordinates must be
  // shifted by this margin (TanStack's scrollMargin) to line up with the
  // container's scrollTop — Virtuoso derived this from customScrollParent
  // automatically. Only measured for `embedded` lists; hosts with their own
  // chrome compensation keep margin 0.
  const [scrollMargin, setScrollMargin] = useState(0);
  const measureScrollMargin = useCallback(() => {
    const wrapper = wrapperRef.current;
    const parent = embedded ? (externalScrollEl ?? scrollParent) : null;
    let margin = 0;
    // parent === wrapper: an `embedded` list that owns its scroller (no
    // external scroll target) — measuring the wrapper against itself would
    // degenerate the margin to scrollTop and feed scroll position back into
    // item coordinates. There is no content above the list inside its own
    // scroller, so the margin is 0 by construction.
    if (wrapper && parent && parent !== wrapper) {
      const parentRect = parent.getBoundingClientRect();
      // A zero-size parent rect means "not laid out" (display:none, or a
      // rect-less test DOM) — rect math would degenerate to scrollTop.
      if (parentRect.width > 0 || parentRect.height > 0) {
        margin = Math.max(
          0,
          Math.round(
            wrapper.getBoundingClientRect().top -
              parentRect.top +
              parent.scrollTop
          )
        );
      }
    }
    setScrollMargin((prev) => (prev === margin ? prev : margin));
  }, [embedded, externalScrollEl, scrollParent]);
  // Re-measured on every commit. Out-of-band shifts (content above changing
  // without this list re-rendering) are only partially covered: the
  // MutationObserver below exists only for ref-based hosts and fires on
  // childList changes (e.g. a sibling list adding rows), not on pure
  // size/attribute changes. A stale margin self-corrects on the next commit —
  // any scroll of the container re-renders the list via the virtualizer and
  // re-measures here.
  useLayoutEffect(measureScrollMargin);

  // A concrete element needs no resolution: getScrollElement consults it
  // directly (the host re-renders us when it changes), so only a ref target
  // gets the observer below.
  useEffect(() => {
    if (externalScrollRef === null) return;
    const sync = (records?: MutationRecord[]) => {
      setScrollParent((prev) =>
        prev === externalScrollRef.current
          ? prev
          : (externalScrollRef.current ?? null)
      );
      // The list's own row churn can't move the wrapper within its container;
      // skip the forced-layout measure for own-subtree mutation batches.
      const wrapper = wrapperRef.current;
      if (
        records &&
        wrapper &&
        records.every((r) => wrapper.contains(r.target))
      )
        return;
      measureScrollMargin();
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [externalScrollRef, measureScrollMargin]);
  const getScrollElement = useCallback(
    () => externalScrollEl ?? scrollParent ?? internalScrollRef.current,
    [externalScrollEl, scrollParent]
  );

  const { virtualizer, scale, toContentScroll, toSpacerScroll } =
    useScaledVirtualizer({
      count: data.length,
      estimateSize: () => estimatedItemHeight,
      getScrollElement,
      overscan,
      // A stable virtualizer option rather than a post-scroll `scrollTop +=`,
      // so tanstack's reconcile re-applies it instead of erasing it on far jumps.
      scrollPaddingStart: scrollPaddingStart ?? 0,
      scrollMargin,
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
            // scrollMargin is unscaled DOM above the list, so it adds after.
            const maxSpacerTop = Math.max(
              0,
              toSpacerScroll(virtualizer.getTotalSize()) +
                scrollMargin -
                el.clientHeight
            );
            return Math.min(target, maxSpacerTop);
          });
        } else {
          release();
        }
      } else if (
        !userScrolledRef.current &&
        !hasResetTopRef.current &&
        resetScrollOnMount
      ) {
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
    scrollMargin,
    resetScrollOnMount,
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

  // Null when this list doesn't participate in find (opted out, or no
  // provider mounted).
  const extendedFind = useExtendedFindOptional();
  const findContext = findScope === "none" ? null : extendedFind;
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
          // Starting a new settle cancels the previous landing while retaining
          // ownership of the auto-scroll guard until the find landing finishes.
          settleScrollToIndex(i, "center");
          setTimeout(onContentReady, 200);
          return Promise.resolve(true);
        }
      }
      return Promise.resolve(false);
    },
    [data, itemSearchText, settleScrollToIndex]
  );

  // Pre-compute lowercased search text for every item once per data /
  // accessor change, so the FindBand counter doesn't re-extract and
  // re-lowercase the whole list on each keystroke. Skipped entirely when the
  // list doesn't participate in find — extraction can be expensive (default
  // accessor JSON.stringifies every item).
  const precomputedSearchTexts = useMemo(() => {
    if (!findContext) return [];
    const getText = itemSearchText ?? ((item: T) => JSON.stringify(item));
    return data.map((item) => {
      const texts = getText(item);
      const textArray = Array.isArray(texts) ? texts : [texts];
      return textArray.map((t) => t.toLowerCase());
    });
  }, [data, itemSearchText, findContext]);

  const countMatchesInData = useCallback<ExtendedCountFn>(
    (term) => {
      if (!term || precomputedSearchTexts.length === 0) return 0;
      return countMatchesInTexts(precomputedSearchTexts, term.toLowerCase());
    },
    [precomputedSearchTexts]
  );

  useEffect(() => {
    if (!findContext) return;
    const u1 = findContext.registerVirtualList(persistenceKey, searchInData);
    const u2 = findContext.registerMatchCounter(
      persistenceKey,
      countMatchesInData
    );
    return () => {
      u1();
      u2();
    };
  }, [findContext, persistenceKey, searchInData, countMatchesInData]);

  const ItemSlot = components?.Item;
  const FooterSlot = components?.Footer;
  const ownsScroll = externalScroll === undefined;

  // Padding divs are in SPACER space (divided by scale) so no element exceeds
  // the browser's max height cap; the rendered band stays in content space.
  // Item coordinates include scrollMargin (they're in scroll-element space);
  // the DOM content above the list already occupies that span, so it is
  // subtracted from the list's own padding. getTotalSize() excludes it.
  const firstItem = items.length > 0 ? items[0] : undefined;
  const lastItem = items.length > 0 ? items[items.length - 1] : undefined;
  const bandStart = firstItem?.start ?? 0;
  const topPaddingContent = firstItem ? firstItem.start - scrollMargin : 0;
  const topPaddingSpacer = topPaddingContent / scale;
  const renderedBandHeight =
    firstItem && lastItem
      ? lastItem.start + lastItem.size - firstItem.start
      : 0;
  const bottomPaddingContent = lastItem
    ? Math.max(
        0,
        virtualizer.getTotalSize() +
          scrollMargin -
          (lastItem.start + lastItem.size)
      )
    : virtualizer.getTotalSize();
  const bottomPaddingSpacer = bottomPaddingContent / scale;

  return (
    <div
      id={id}
      ref={(el) => {
        wrapperRef.current = el;
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
          const top = vItem.start - bandStart;
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
