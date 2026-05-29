import { RefObject, useEffect } from "react";
import { VirtuosoHandle } from "react-virtuoso";

import type { VirtualListHandle } from "../virtual/types";

interface ListKeyboardNavigationOptions {
  /** Virtuoso or VirtualList handle — used when the list is virtualized. */
  listHandle: RefObject<VirtuosoHandle | VirtualListHandle | null>;
  /** Scroll container — required for jump-to-top/bottom (preferred path). */
  scrollRef?: RefObject<HTMLDivElement | null>;
  /** Total number of items in the list. */
  itemCount: number;
}

/**
 * Registers Cmd/Ctrl+ArrowUp/Down keyboard shortcuts on `document` to jump
 * to the top or bottom of a virtualized (or plain-DOM) list.
 *
 * Jumps use direct scrollTo on the scroll container, not virtualizer-aware
 * positioning — virtualizers either need pre-measurement (which would
 * require an extra round-trip) or animate across the full distance, which
 * is visibly janky on huge lists. Direct scrollTo to scrollHeight/0 is
 * instant regardless of measurement state.
 */
export function useListKeyboardNavigation({
  listHandle,
  scrollRef,
  itemCount,
}: ListKeyboardNavigationOptions): void {
  useEffect(() => {
    const jumpTo = (top: number) => {
      const el = scrollRef?.current;
      if (!el) return false;
      // Force-disable any scroll-behavior: smooth that would let Firefox
      // animate the jump and let subsequent key presses interrupt it.
      const prev = el.style.scrollBehavior;
      el.style.scrollBehavior = "auto";
      el.scrollTop = top;
      el.style.scrollBehavior = prev;
      return true;
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;

      // Capture phase + stopImmediatePropagation so Firefox's default
      // Cmd+Down "scroll one page" never gets a chance to fire.
      event.preventDefault();
      event.stopImmediatePropagation();

      if (event.key === "ArrowUp") {
        if (!jumpTo(0) && listHandle.current) {
          listHandle.current.scrollToIndex({
            index: 0,
            align: "start",
            behavior: "auto",
          });
        }
      } else {
        const el = scrollRef?.current;
        if (el) {
          jumpTo(el.scrollHeight);
        } else if (listHandle.current) {
          listHandle.current.scrollToIndex({
            index: Math.max(itemCount - 1, 0),
            align: "end",
            behavior: "auto",
          });
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => {
      document.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, [listHandle, scrollRef, itemCount]);
}
