import { useEventListener } from "../hooks/useEventListener";

import { isFindShortcut } from "./findShortcuts";

interface UseFindBandShortcutOptions {
  // Escape handler; omit to leave Escape untouched
  onClose?: () => void;
  // Whether the band is currently open. Escape only closes while open —
  // gated here so call sites don't each have to conditionally pass onClose.
  isOpen?: boolean;
  // Disable entirely, e.g. when the host defers to native browser find
  enabled?: boolean;
}

/**
 * Global Ctrl/Cmd+F shortcut companion to `FindBand`: opens the band
 * (blocking the browser's own find dialog) and optionally closes it on
 * Escape.
 */
export function useFindBandShortcut(
  onOpen: () => void,
  options?: UseFindBandShortcutOptions
): void {
  const { onClose, isOpen = false, enabled = true } = options ?? {};

  // Capture phase so the shortcut wins before the browser's own find.
  useEventListener(
    enabled ? document : null,
    "keydown",
    (e) => {
      if (isFindShortcut(e)) {
        e.preventDefault();
        e.stopPropagation();
        onOpen();
      } else if (e.key === "Escape" && isOpen && onClose) {
        onClose();
      }
    },
    { capture: true }
  );
}
