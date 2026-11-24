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
  // Take the shortcut ahead of every document listener (it listens on
  // window), so a view's own find opens instead of the page's band
  preempt?: boolean;
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
  const {
    onClose,
    isOpen = false,
    enabled = true,
    preempt = false,
  } = options ?? {};

  const handleKeyDown = (e: KeyboardEvent) => {
    if (isFindShortcut(e)) {
      e.preventDefault();
      e.stopPropagation();
      onOpen();
    } else if (e.key === "Escape" && isOpen && onClose) {
      onClose();
    }
  };

  // Capture phase so the shortcut wins before the browser's own find.
  useEventListener(
    enabled && !preempt ? document : null,
    "keydown",
    handleKeyDown,
    {
      capture: true,
    }
  );
  useEventListener(
    enabled && preempt ? window : null,
    "keydown",
    handleKeyDown,
    {
      capture: true,
    }
  );
}
