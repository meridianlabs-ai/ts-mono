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

function isEditableTarget(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
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

      // Don't hijack cursor navigation in editable elements
      if (isEditableTarget(document.activeElement)) return;

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
