import { type RefObject } from "react";

import { useEventListener } from "./useEventListener";

/**
 * Calls `handler` for any press outside `ref`'s element — the named
 * replacement for the "close the popover/menu on outside click" effect.
 *
 * Listens on `mousedown` by default so the dismissal wins over click
 * handlers inside the opening element; pass `"pointerdown"` to also catch
 * touch/pen. The handler is typed `MouseEvent` either way (an overload
 * surfacing `PointerEvent` fails strictFunctionTypes variance against the
 * shared implementation); narrow with `instanceof PointerEvent` to read
 * pointer fields.
 *
 * "Outside" is DOM-tree containment: content rendered through a portal that
 * is logically inside the popover still counts as an outside press.
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
