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
      // Some macOS Firefox configurations remap Cmd+Down to End / Cmd+Up
      // to Home. Accept both.
      const isUp =
        (event.key === "ArrowUp" && (event.metaKey || event.ctrlKey)) ||
        (event.key === "Home" && (event.metaKey || event.ctrlKey));
      const isDown =
        (event.key === "ArrowDown" && (event.metaKey || event.ctrlKey)) ||
        (event.key === "End" && (event.metaKey || event.ctrlKey));
      if (!isUp && !isDown) return;

      event.preventDefault();
      event.stopImmediatePropagation();

      if (isUp) {
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

    // Attach to both window and document, capture phase, so Firefox's
    // built-in "Cmd+Down → page-down" gets intercepted no matter which
    // node first sees the event. Window is the outermost target; capture
    // there means we fire before any default action.
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    document.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
      document.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, [listHandle, scrollRef, itemCount]);
}
