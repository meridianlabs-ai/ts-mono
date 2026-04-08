import { RefObject, useEffect } from "react";
import { VirtuosoHandle } from "react-virtuoso";

interface ListKeyboardNavigationOptions {
  /** Virtuoso list handle — used when the list is virtualized. */
  listHandle: RefObject<VirtuosoHandle | null>;
  /** Scroll container — used as fallback when the list is not virtualized. */
  scrollRef?: RefObject<HTMLDivElement | null>;
  /** Total number of items in the list. */
  itemCount: number;
}

/**
 * Registers Cmd/Ctrl+ArrowUp/Down keyboard shortcuts on `document` to jump
 * to the top or bottom of a virtualized (or plain-DOM) list.
 *
 * When the Virtuoso handle is available it delegates to `scrollToIndex`;
 * otherwise it falls back to `scrollTo` on the scroll container.
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
        if (listHandle.current) {
          listHandle.current.scrollToIndex({ index: 0, align: "center" });
        } else {
          scrollRef?.current?.scrollTo({ top: 0, behavior: "instant" });
        }
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        if (listHandle.current) {
          listHandle.current.scrollToIndex({
            index: Math.max(itemCount - 5, 0),
            align: "center",
          });

          // Virtuoso needs to measure the near-bottom items before it can
          // accurately scroll to the very last item.
          setTimeout(() => {
            listHandle.current?.scrollToIndex({
              index: Math.max(itemCount - 1, 0),
              align: "end",
            });
          }, 250);
        } else {
          const el = scrollRef?.current;
          if (el) {
            el.scrollTo({ top: el.scrollHeight, behavior: "instant" });
          }
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [listHandle, scrollRef, itemCount]);
}
