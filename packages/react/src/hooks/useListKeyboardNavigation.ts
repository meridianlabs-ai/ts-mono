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
      if (!(event.metaKey || event.ctrlKey)) return;

      if (event.key === "ArrowUp") {
        event.preventDefault();
        const el = scrollRef?.current;
        if (el) {
          el.scrollTo({ top: 0, behavior: "instant" });
        } else if (listHandle.current) {
          listHandle.current.scrollToIndex({
            index: 0,
            align: "start",
            behavior: "auto",
          });
        }
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        const el = scrollRef?.current;
        if (el) {
          el.scrollTo({ top: el.scrollHeight, behavior: "instant" });
        } else if (listHandle.current) {
          listHandle.current.scrollToIndex({
            index: Math.max(itemCount - 1, 0),
            align: "end",
            behavior: "auto",
          });
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [listHandle, scrollRef, itemCount]);
}
