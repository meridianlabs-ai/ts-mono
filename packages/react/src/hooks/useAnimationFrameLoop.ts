import { useEffect } from "react";

import { useLatestRef } from "./useLatestRef";

/**
 * Calls the latest `callback` once per animation frame while `active`, with
 * the seconds elapsed since the previous frame (0 on the first frame after
 * starting, so time spent inactive is never counted).
 */
export function useAnimationFrameLoop(
  callback: (elapsedSeconds: number, now: number) => void,
  active: boolean
): void {
  const callbackRef = useLatestRef(callback);
  useEffect(() => {
    if (!active) return;
    let previous: number | undefined;
    let id = requestAnimationFrame(function frame(now) {
      const elapsed = previous === undefined ? 0 : (now - previous) / 1000;
      previous = now;
      callbackRef.current(elapsed, now);
      id = requestAnimationFrame(frame);
    });
    return () => cancelAnimationFrame(id);
  }, [active, callbackRef]);
}
