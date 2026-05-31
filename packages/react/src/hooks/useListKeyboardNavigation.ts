import { RefObject, useEffect } from "react";

import { isEditableTarget } from "@tsmono/util";

import type { VirtualListHandle } from "../virtual/types";

interface ListKeyboardNavigationOptions {
  listHandle: RefObject<VirtualListHandle | null>;
  /** Scroll container — required for jump-to-top/bottom (preferred path). */
  scrollRef?: RefObject<HTMLDivElement | null>;
  /** Total number of items in the list. */
  itemCount: number;
}

export function useListKeyboardNavigation({
  listHandle,
  scrollRef,
  itemCount,
}: ListKeyboardNavigationOptions): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const hasModifier = event.metaKey || event.ctrlKey;
      const isUp =
        (event.key === "ArrowUp" && hasModifier) ||
        (event.key === "Home" && hasModifier);
      const isDown =
        (event.key === "ArrowDown" && hasModifier) ||
        (event.key === "End" && hasModifier);
      if (!isUp && !isDown) return;

      if (isEditableTarget(document.activeElement)) return;

      event.preventDefault();
      event.stopImmediatePropagation();

      const handle = listHandle.current;

      if (isUp) {
        if (handle) {
          handle.jumpToStart();
        } else {
          scrollRef?.current?.scrollTo({ top: 0 });
        }
      } else {
        if (handle) {
          handle.jumpToEnd();
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
