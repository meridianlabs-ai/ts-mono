import { RefCallback, useCallback, useState } from "react";

/**
 * Shows a popover element in the top layer, anchored to `anchor` through the
 * CSS anchor name `anchorName`. Attach the returned ref to the `[popover]`
 * element; `shown` turns true once it is showing. `trigger` is the control
 * that opened it: keyboard focus moves from it into the popover, and returns
 * to it.
 *
 * Render the popover's content only once `shown` is true. A popover that
 * isn't showing is `display: none`, so content mounted with it couldn't take
 * focus (`autoFocus`) or measure itself. The ref runs during the commit, and
 * React re-renders synchronously before paint, so the content still appears
 * in the first painted frame.
 *
 * The anchor name is added to (and later removed from) the anchor's inline
 * `anchor-name` list, so two popovers can share one anchor. On teardown,
 * focus inside the popover returns to the trigger: removing a popover from
 * the DOM would otherwise drop focus to `<body>`.
 */
export function useAnchoredPopover(
  anchor: HTMLElement,
  trigger: HTMLElement,
  anchorName: string
): { ref: RefCallback<HTMLElement>; shown: boolean } {
  const [shown, setShown] = useState(false);
  // useCallback for identity, not speed: React re-runs a ref callback (hiding
  // and re-showing the popover) whenever its identity changes.
  const ref = useCallback(
    (popover: HTMLElement | null) => {
      if (!popover) return;
      const removeAnchorName = addAnchorName(anchor, anchorName);
      popover.showPopover({ source: trigger });
      setShown(true);
      return () => {
        const hadFocus = popover.contains(document.activeElement);
        // A no-op when the browser has already hidden it (light dismiss).
        popover.hidePopover();
        removeAnchorName();
        if (hadFocus) trigger.focus({ preventScroll: true });
      };
    },
    [anchor, trigger, anchorName]
  );
  return { ref, shown };
}

const addAnchorName = (el: HTMLElement, name: string): (() => void) => {
  const names = (value: string) =>
    value
      .split(",")
      .map((n) => n.trim())
      .filter((n) => n !== "" && n !== "none");
  el.style.setProperty(
    "anchor-name",
    [...names(el.style.getPropertyValue("anchor-name")), name].join(", ")
  );
  return () => {
    const rest = names(el.style.getPropertyValue("anchor-name")).filter(
      (n) => n !== name
    );
    if (rest.length > 0) el.style.setProperty("anchor-name", rest.join(", "));
    else el.style.removeProperty("anchor-name");
  };
};
