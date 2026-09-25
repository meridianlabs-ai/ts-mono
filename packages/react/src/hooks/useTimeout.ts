import { useEffect } from "react";

import { useLatestRef } from "./useLatestRef";

/**
 * Declarative `setTimeout`: calls the latest `callback` once, `delayMs`
 * milliseconds after mount. Pass `null` to cancel. Changing `delayMs`
 * restarts the timer. An optional `resetKey` also restarts it when its identity changes.
 */
export function useTimeout(
  callback: () => void,
  delayMs: number | null,
  resetKey?: unknown
): void {
  const callbackRef = useLatestRef(callback);
  useEffect(() => {
    if (delayMs === null) return;
    const id = window.setTimeout(() => callbackRef.current(), delayMs);
    return () => window.clearTimeout(id);
  }, [delayMs, callbackRef, resetKey]);
}
