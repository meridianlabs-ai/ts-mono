import { useEffect } from "react";

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
 * Escape. Pass stable callbacks — they are effect dependencies.
 */
export function useFindBandShortcut(
  onOpen: () => void,
  options?: UseFindBandShortcutOptions
): void {
  const { onClose, isOpen = false, enabled = true } = options ?? {};

  useEffect(() => {
    if (!enabled) return;

    const handleOpenKey = (e: KeyboardEvent) => {
      if (isFindShortcut(e)) {
        e.preventDefault();
        e.stopPropagation();
        onOpen();
      }
    };
    // Escape closes topmost-only: bubble phase, so an overlay above the band
    // (e.g. the transcript's go-to-turn bar) can consume its Escape first
    // via stopPropagation.
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen && onClose) {
        onClose();
      }
    };

    // Capture phase so the shortcut wins before the browser's own find.
    document.addEventListener("keydown", handleOpenKey, true);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("keydown", handleOpenKey, true);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [enabled, onOpen, onClose, isOpen]);
}
