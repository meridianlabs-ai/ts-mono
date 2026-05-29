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
    const handleKeyDown = (event: KeyboardEvent) => {
      const isUp =
        (event.key === "ArrowUp" && (event.metaKey || event.ctrlKey)) ||
        event.key === "Home";
      const isDown =
        (event.key === "ArrowDown" && (event.metaKey || event.ctrlKey)) ||
        event.key === "End";
      if (!isUp && !isDown) return;

      event.preventDefault();
      event.stopImmediatePropagation();

      const handle = listHandle.current;

      if (isUp) {
        if (handle && "jumpToStart" in handle) {
          (handle as { jumpToStart(): void }).jumpToStart();
        } else if (handle) {
          handle.scrollToIndex({ index: 0, align: "start", behavior: "auto" });
        } else {
          scrollRef?.current?.scrollTo({ top: 0 });
        }
      } else {
        if (handle && "jumpToEnd" in handle) {
          (handle as { jumpToEnd(): void }).jumpToEnd();
        } else if (handle) {
          handle.scrollToIndex({
            index: Math.max(itemCount - 1, 0),
            align: "end",
            behavior: "auto",
          });
        } else {
          const el = scrollRef?.current;
          if (el) el.scrollTop = el.scrollHeight;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, [listHandle, scrollRef, itemCount]);
}
