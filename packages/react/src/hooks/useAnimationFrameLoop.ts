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
    return startFrameLoop((elapsed, now) => {
      callbackRef.current(elapsed, now);
    });
  }, [active, callbackRef]);
}

const startFrameLoop = (
  onFrame: (elapsedSeconds: number, now: number) => void
): (() => void) => {
  let previous: number | undefined;
  let id = 0;
  const frame = (now: number) => {
    const elapsed = previous === undefined ? 0 : (now - previous) / 1000;
    previous = now;
    onFrame(elapsed, now);
    id = requestAnimationFrame(frame);
  };
  id = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(id);
};
