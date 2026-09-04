import { useCallback, useEffect, useRef } from "react";

import type { FindRow } from "../find/types";

/**
 * A surface's `reveal` over a host that may hold only a loaded prefix of its
 * rows: a row the host has (`revealLoaded` true) is shown at once; a row past
 * the prefix (`row.index >= loadedCount`) is paged in through the host's
 * load-more and shown once its rows arrive; on a host whose rows still grow
 * on their own (`mayGrow`, a running sample polled from a buffer the source
 * may be ahead of) it waits for them. A row the host should have but does
 * not (its index is loaded, or nothing more can arrive) is an anchor
 * mismatch between source and surface: it is dropped and logged rather than
 * guessed at by index.
 */
export function usePendingFindReveal(
  revealLoaded: (row: FindRow) => boolean,
  loadedCount: number,
  hasMoreRows: boolean | undefined,
  onLoadMoreRows: (() => void) | undefined,
  mayGrow = false
): (row: FindRow, signal: AbortSignal) => void {
  const pending = useRef<{ row: FindRow; signal: AbortSignal } | null>(null);
  // Returns whether the reveal is settled (shown, aborted, or unreachable).
  const attempt = useCallback(
    (row: FindRow, signal: AbortSignal): boolean => {
      if (signal.aborted || revealLoaded(row)) return true;
      if (row.index < loadedCount || (!hasMoreRows && !mayGrow)) {
        console.warn(
          `find: row ${row.anchor.id} (index ${row.index}) is not among the ${loadedCount} loaded rows`
        );
        return true;
      }
      if (hasMoreRows) onLoadMoreRows?.();
      return false;
    },
    [revealLoaded, loadedCount, hasMoreRows, onLoadMoreRows, mayGrow]
  );
  useEffect(() => {
    const p = pending.current;
    if (p && attempt(p.row, p.signal)) pending.current = null;
  }, [attempt]);
  return useCallback(
    (row, signal) => {
      pending.current = attempt(row, signal) ? null : { row, signal };
    },
    [attempt]
  );
}
