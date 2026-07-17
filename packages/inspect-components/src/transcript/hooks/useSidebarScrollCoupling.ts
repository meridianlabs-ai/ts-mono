/**
 * Couples sticky sidebars to the main scroll container.
 *
 * Forwards wheel events from a sidebar to the main scroller only while the
 * header above the tabs is still visible. Once the sidebar is stuck at its
 * sticky top (header fully out), wheel events stop chaining so the main
 * content doesn't scroll along with the sidebar. Also dispatches a synthetic
 * scroll event when a sidebar mounts/unmounts: the layout reflows but no
 * scroll/resize event fires, so sticky-state observers (useStickyObserver,
 * StickyScroll) would otherwise keep stale state.
 *
 * Nothing here is transcript-specific; candidate for @tsmono/react/hooks.
 */

import { useEffect, useRef, type RefObject } from "react";

export interface SidebarScrollTarget {
  /** The sidebar's sticky scroll container. */
  scrollRef?: RefObject<HTMLDivElement | null>;
  /** Changes when the sidebar mounts/unmounts (conditional render), forcing
   *  listener re-attachment and a sticky re-measure. */
  remountKey: unknown;
}

export interface UseSidebarScrollCouplingOptions {
  /** The main scroll container. */
  mainScrollRef: RefObject<HTMLDivElement | null>;
  /** Sidebars to couple. Memoize — identity changes drive re-attachment. */
  sidebars: ReadonlyArray<SidebarScrollTarget>;
  /** Per-sidebar sticky offsets in px (parallel to `sidebars`). Read at
   *  wheel time through a ref, so offset changes don't re-attach listeners. */
  stickyTops: ReadonlyArray<number>;
}

export function useSidebarScrollCoupling(
  options: UseSidebarScrollCouplingOptions
): void {
  const { mainScrollRef, sidebars, stickyTops } = options;

  const stickyTopsRef = useRef(stickyTops);
  useEffect(() => {
    stickyTopsRef.current = stickyTops;
  }, [stickyTops]);

  // Synthetic scroll on sidebar mount/unmount, after the DOM has settled.
  useEffect(() => {
    const el = mainScrollRef.current;
    if (!el) return;
    const timer = setTimeout(() => {
      el.dispatchEvent(new Event("scroll"));
    }, 0);
    return () => clearTimeout(timer);
  }, [sidebars, mainScrollRef]);

  useEffect(() => {
    const main = mainScrollRef.current;
    if (!main) return;

    const makeHandler =
      (sidebar: HTMLDivElement, index: number) => (e: WheelEvent) => {
        const mainMaxTop = main.scrollHeight - main.clientHeight;
        // Is the sidebar currently stuck at its sticky top? If so, the header
        // above the tabs has already scrolled off — don't chain further main
        // scrolling or the main content itself would move with the sidebar.
        const mainRect = main.getBoundingClientRect();
        const sidebarRect = sidebar.getBoundingClientRect();
        const sidebarTopInScroller = sidebarRect.top - mainRect.top;
        const stickyTop = stickyTopsRef.current[index] ?? 0;
        const sidebarIsSticky = sidebarTopInScroller <= stickyTop + 1;

        if (!sidebarIsSticky) {
          // Header still visible — forward all wheel input to the main
          // scroller so that the header collapses/expands. Suppress the
          // sidebar's default scroll for this step.
          const canMain =
            (e.deltaY > 0 && main.scrollTop < mainMaxTop - 0.5) ||
            (e.deltaY < 0 && main.scrollTop > 0.5);
          if (canMain) {
            e.preventDefault();
            main.scrollBy({ top: e.deltaY, behavior: "auto" });
          }
        } else if (
          e.deltaY < 0 &&
          sidebar.scrollTop <= 0 &&
          main.scrollTop > 0
        ) {
          // Sidebar is sticky and already at its own top — wheeling up should
          // bring the header back, so forward to main.
          e.preventDefault();
          main.scrollBy({ top: e.deltaY, behavior: "auto" });
        }
        // Otherwise let the sidebar's native wheel scroll proceed.
      };

    const entries = sidebars.flatMap((target, index) => {
      const el = target.scrollRef?.current;
      if (!el) return [];
      const handler = makeHandler(el, index);
      // passive: false so we can preventDefault when taking over the scroll.
      el.addEventListener("wheel", handler, { passive: false });
      return [{ el, handler }];
    });
    return () => {
      for (const { el, handler } of entries) {
        el.removeEventListener("wheel", handler);
      }
    };
  }, [mainScrollRef, sidebars]);
}
