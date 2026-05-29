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

function isVirtualListHandle(
  handle: VirtuosoHandle | VirtualListHandle
): handle is VirtualListHandle {
  return "jumpToStart" in handle;
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
        if (handle && isVirtualListHandle(handle)) {
          handle.jumpToStart();
        } else if (handle) {
          handle.scrollToIndex({ index: 0, align: "center" });
        } else {
          scrollRef?.current?.scrollTo({ top: 0 });
        }
      } else {
        if (handle && isVirtualListHandle(handle)) {
          handle.jumpToEnd();
        } else if (handle) {
          // Virtuoso two-pass: scroll near bottom first so it measures
          // the last rows, then land on the actual last item.
          handle.scrollToIndex({
            index: Math.max(itemCount - 5, 0),
            align: "center",
          });
          setTimeout(() => {
            listHandle.current?.scrollToIndex({
              index: Math.max(itemCount - 1, 0),
              align: "end",
            });
          }, 250);
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
