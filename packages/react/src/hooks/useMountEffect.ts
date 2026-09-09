import { useEffect, type EffectCallback } from "react";

/**
 * Runs `effect` once when the component mounts; its returned cleanup runs on
 * unmount. For one-time setup/teardown of something external — a library
 * instance, an app-level registration, a timer that outlives renders.
 *
 * The effect captures the first render's closure and never re-runs, so it
 * must not depend on values that change across renders — read those through
 * `useLatestRef` instead.
 */
export function useMountEffect(effect: EffectCallback): void {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only by contract; capturing the first render's closure is the point
  useEffect(effect, []);
}
