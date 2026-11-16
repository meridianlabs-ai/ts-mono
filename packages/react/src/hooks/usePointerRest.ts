import { useEffect } from "react";

import { useLatestRef } from "./useLatestRef";

/**
 * Calls `onRest` once the pointer has stayed still over `target` for
 * `delayMs`. The timer starts as soon as `target` is set (the caller usually
 * sets it from a mouseenter, with the pointer already over it), restarts on
 * every move and stops when the pointer leaves.
 */
export function usePointerRest(
  target: HTMLElement | null,
  delayMs: number,
  onRest: () => void
): void {
  const onRestRef = useLatestRef(onRest);
  useEffect(() => {
    if (!target) return;
    let timer: number | undefined;
    const restart = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => onRestRef.current(), delayMs);
    };
    const stop = () => window.clearTimeout(timer);
    restart();
    target.addEventListener("mousemove", restart);
    target.addEventListener("mouseleave", stop);
    return () => {
      stop();
      target.removeEventListener("mousemove", restart);
      target.removeEventListener("mouseleave", stop);
    };
  }, [target, delayMs, onRestRef]);
}
