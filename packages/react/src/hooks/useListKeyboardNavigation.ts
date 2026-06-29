import { RefObject, useEffect, useRef } from "react";

import { isEditableTarget } from "@tsmono/util";

import type { VirtualListHandle } from "../virtual/types";

interface ListKeyboardNavigationOptions {
  listHandle: RefObject<VirtualListHandle | null>;
  /** Scroll container — required for jump-to-top/bottom (preferred path). */
  scrollRef?: RefObject<HTMLDivElement | null>;
  /** Total number of items in the list. */
  itemCount: number;
  /** `j` — scroll to the next turn (down, vim-style). */
  onNext?: () => void;
  /** `k` — scroll to the previous turn (up, vim-style). */
  onPrev?: () => void;
  /** `h` — move to the previous agent lane (left, vim-style). */
  onPrevAgent?: () => void;
  /** `l` — move to the next agent lane (right, vim-style). */
  onNextAgent?: () => void;
  /** `gg` — jump to the first turn (vim-style). */
  onFirst?: () => void;
  /** `G` — jump to the last turn (vim-style). */
  onLast?: () => void;
  /**
   * When true, all shortcuts stand down so another surface can own the
   * keyboard (e.g. find-in-page is open — its keys, including a post-blur
   * `g`/`j`, must reach the find box rather than navigate the list).
   */
  disabled?: boolean;
}

export function useListKeyboardNavigation({
  listHandle,
  scrollRef,
  itemCount,
  onNext,
  onPrev,
  onPrevAgent,
  onNextAgent,
  onFirst,
  onLast,
  disabled,
}: ListKeyboardNavigationOptions): void {
  // Timestamp of the last lone `g`, for recognizing the `gg` two-stroke.
  const lastGTimeRef = useRef(0);
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (disabled) return;
      const hasModifier = event.metaKey || event.ctrlKey || event.altKey;

      // `j` / `k` step between turns. Plain keys, so ignore them while a
      // modifier is held (don't swallow browser/OS chords) or while typing.
      if (!hasModifier && (event.key === "j" || event.key === "k")) {
        if (!onNext && !onPrev) return;
        if (isEditableTarget(document.activeElement)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        // vim-style: j = down (next turn), k = up (previous turn).
        if (event.key === "j") onNext?.();
        else onPrev?.();
        return;
      }

      // `h` / `l` step between agent lanes (subagents). Same guards as j/k.
      if (!hasModifier && (event.key === "h" || event.key === "l")) {
        if (!onPrevAgent && !onNextAgent) return;
        if (isEditableTarget(document.activeElement)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        // vim-style: h = left (previous agent), l = right (next agent).
        if (event.key === "h") onPrevAgent?.();
        else onNextAgent?.();
        return;
      }

      // `G` jumps to the last turn; `gg` (double-tap g) to the first.
      if (!hasModifier && (event.key === "g" || event.key === "G")) {
        if (!onFirst && !onLast) return;
        if (isEditableTarget(document.activeElement)) return;
        if (event.key === "G") {
          event.preventDefault();
          event.stopImmediatePropagation();
          lastGTimeRef.current = 0;
          onLast?.();
          return;
        }
        // lowercase g: second g within the window fires gg → first turn.
        const now = Date.now();
        if (now - lastGTimeRef.current < 500) {
          event.preventDefault();
          event.stopImmediatePropagation();
          lastGTimeRef.current = 0;
          onFirst?.();
        } else {
          lastGTimeRef.current = now;
        }
        return;
      }

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
  }, [
    listHandle,
    scrollRef,
    itemCount,
    onNext,
    onPrev,
    onPrevAgent,
    onNextAgent,
    onFirst,
    onLast,
    disabled,
  ]);
}
