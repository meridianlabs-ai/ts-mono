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
