import { useEffect } from "react";

import { useLatestRef } from "./useLatestRef";

/**
 * Declarative `setInterval`: calls the latest `callback` every `delayMs`
 * milliseconds. Pass `null` to pause. Changing `delayMs` resets the interval.
 */
export function useInterval(
  callback: () => void,
  delayMs: number | null
): void {
  const callbackRef = useLatestRef(callback);
  useEffect(() => {
    if (delayMs === null) return;
    const id = window.setInterval(() => callbackRef.current(), delayMs);
    return () => window.clearInterval(id);
  }, [delayMs, callbackRef]);
}
