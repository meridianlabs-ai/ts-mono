import { useEffect } from "react";

import { useLatestRef } from "./useLatestRef";

/**
 * Runs `fn` once when the component unmounts. Always calls the latest `fn`,
 * so it can close over current state/props without dependency plumbing.
 */
export function useUnmount(fn: () => void): void {
  const fnRef = useLatestRef(fn);
  useEffect(() => () => fnRef.current(), [fnRef]);
}
