import { useLayoutEffect, useRef, type RefObject } from "react";

/**
 * Returns a ref that always holds the latest `value`.
 *
 * The named replacement for the hand-rolled "mirror a value into a ref"
 * effect: lets stable callbacks (subscriptions, timers, imperative handles)
 * read current state/props without listing them as dependencies.
 */
export function useLatestRef<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  // Layout effect, not a render-time write (compiler-safe), and it commits
  // before any passive effect in the same commit reads it.
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
