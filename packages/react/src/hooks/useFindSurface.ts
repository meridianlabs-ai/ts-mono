import { useEffect, useRef } from "react";

import { useFindCoordinatorOptional } from "../find/FindCoordinatorContext";
import type { FindSurface } from "../find/types";

import { useLatestRef } from "./useLatestRef";

/** Register a surface for as long as the component is mounted (no-op
 *  outside a FindProvider). Registration is per scope; a new source identity
 *  is swapped in place and a change of `dataKey` (the surface's data changed
 *  under the same source) re-surveys, both keeping the window on screen.
 *  reveal() is read through a ref: it closes over fast-moving view state
 *  (selection, scroll handles). */
export const useFindSurface = (
  surface: FindSurface | null,
  dataKey?: unknown
): void => {
  const store = useFindCoordinatorOptional();
  const latest = useLatestRef(surface);
  const lastDataKey = useRef(dataKey);
  const scopeId = surface?.scopeId;
  const source = surface?.source;
  useEffect(() => {
    const current = latest.current;
    if (!store || scopeId === undefined || !current) return;
    return store.registerSurface({
      scopeId,
      source: current.source,
      reveal: (match, signal) => {
        latest.current?.reveal(match, signal);
      },
    });
  }, [store, scopeId, latest]);
  useEffect(() => {
    if (store && scopeId !== undefined && source) {
      store.updateSource(scopeId, source);
    }
  }, [store, scopeId, source]);
  useEffect(() => {
    if (lastDataKey.current === dataKey) return;
    lastDataKey.current = dataKey;
    if (store && scopeId !== undefined) store.invalidate(scopeId);
  }, [store, scopeId, dataKey]);
};
