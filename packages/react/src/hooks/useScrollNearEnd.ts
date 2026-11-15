import { useEffect, type RefObject } from "react";

import { useEventListener } from "./useEventListener";
import { useLatestRef } from "./useLatestRef";

interface ScrollNearEndOptions {
  /** Off while there is nothing more to load. */
  enabled: boolean;
  /** Distance from the bottom, in px, that counts as near the end. */
  threshold: number;
  /** Changes when the content changes (e.g. the row count). Each change
   *  re-checks without a scroll, since new or initial content can leave the
   *  element near its end, e.g. a first page shorter than the viewport. */
  contentKey: unknown;
  /** Receives the remaining distance from the bottom in px. */
  onNearEnd: (distanceFromBottom: number) => void;
}

/** Calls `onNearEnd` when `el` is within `threshold` px of its bottom. */
function checkNearEnd(
  el: HTMLElement | null,
  threshold: number,
  onNearEnd: (distanceFromBottom: number) => void
): void {
  if (!el) return;
  const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
  if (distance < threshold) onNearEnd(distance);
}

/**
 * Calls `onNearEnd` when the scroll element comes within `threshold` px of
 * its bottom, for loading the next page of an infinite list.
 */
export function useScrollNearEnd(
  ref: RefObject<HTMLElement | null>,
  { enabled, threshold, contentKey, onNearEnd }: ScrollNearEndOptions
): void {
  const onNearEndRef = useLatestRef(onNearEnd);
  useEventListener(
    ref,
    "scroll",
    () => {
      if (enabled) checkNearEnd(ref.current, threshold, onNearEndRef.current);
    },
    { passive: true }
  );
  useEffect(() => {
    if (enabled) checkNearEnd(ref.current, threshold, onNearEndRef.current);
  }, [ref, onNearEndRef, enabled, threshold, contentKey]);
}
