import { type RefObject } from "react";

import { useEventListener } from "./useEventListener";

/**
 * Calls `handler` for any press outside `ref`'s element — the named
 * replacement for the "close the popover/menu on outside click" effect.
 *
 * Listens on `mousedown` by default so the dismissal wins over click
 * handlers inside the opening element; pass `"pointerdown"` to also catch
 * touch/pen.
 */
export function useOnClickOutside(
  ref: RefObject<HTMLElement | null>,
  handler: (event: MouseEvent) => void,
  eventType: "mousedown" | "pointerdown" = "mousedown"
): void {
  useEventListener(document, eventType, (event) => {
    const element = ref.current;
    if (
      !element ||
      !(event.target instanceof Node) ||
      element.contains(event.target)
    ) {
      return;
    }
    handler(event);
  });
}
