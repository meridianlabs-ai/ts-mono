import { useRef, useState } from "react";

import { useUnmount } from "./useUnmount";

/**
 * Clipboard write with a transient "copied" flag for confirm-icon feedback.
 * The flag flips only after the write resolves (it can reject in an unfocused
 * document, and flipping early reads as a false success) and clears
 * `confirmMs` after the latest successful copy.
 */
export function useCopyToClipboard(confirmMs = 1250) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useUnmount(() => window.clearTimeout(timer.current));
  const copy = (text: string) => {
    // Deferred so a missing clipboard (plain http on a LAN host) rejects into
    // the .catch instead of throwing synchronously from the click handler.
    Promise.resolve()
      .then(() => navigator.clipboard.writeText(text))
      .then(() => {
        setCopied(true);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), confirmMs);
      })
      .catch((error: unknown) => {
        console.error("Failed to copy:", error);
      });
  };
  return { copied, copy };
}
