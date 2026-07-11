import { useEffect } from "react";

interface UseFindBandShortcutOptions {
  // Escape handler; omit to leave Escape untouched (e.g. band not open)
  onClose?: () => void;
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
  const { onClose, enabled = true } = options ?? {};

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // toLowerCase: CapsLock yields "F"
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        e.stopPropagation();
        onOpen();
      } else if (e.key === "Escape" && onClose) {
        onClose();
      }
    };

    // Capture phase so the shortcut wins before the browser's own find.
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [enabled, onOpen, onClose]);
}
