import { useEffect } from "react";

import { useLatestRef } from "./useLatestRef";

/**
 * Mirrors `value` into an external store each time it changes, so the store
 * remembers the last value seen even after the source stops providing one
 * (e.g. a route param the user has since navigated away from).
 *
 * `undefined` is "nothing to remember" and is never written — the store
 * keeps its previous value. Always calls the latest `write`, so callers pass
 * a store setter without dependency plumbing.
 */
export function useMirrorToStore<T>(
  value: T | undefined,
  write: (value: T) => void
): void {
  const writeRef = useLatestRef(write);
  useEffect(() => {
    if (value !== undefined) writeRef.current(value);
  }, [value, writeRef]);
}

export type MirrorKey = readonly (string | boolean | undefined)[];

/**
 * The keyed form of `useMirrorToStore`, for a value with no primitive
 * identity (a tuple of route params). Runs `write` when the first render has
 * a key and again each time the key's elements change, compared one by one
 * like an effect's deps. An `undefined` key is "nothing to mirror" and never
 * writes, so the store keeps what the last key wrote. `write` is always the
 * latest closure, so it can read the params the key was built from.
 */
export function useMirrorKeyedToStore(
  key: MirrorKey | undefined,
  write: () => void
): void {
  // JSON keeps the elements' types apart ("true" vs true, undefined vs "")
  // so two keys serialize alike only when they would compare equal
  // element-wise. Numbers are excluded because NaN, Infinity and -0 do not
  // round-trip, and null because it serializes the same as undefined.
  useMirrorToStore(key === undefined ? undefined : JSON.stringify(key), write);
}
