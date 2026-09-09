import { RefObject, useEffect, useMemo, useRef } from "react";

interface ListPositionManagerResult {
  /** The effective list ID incorporating the current selection. */
  effectiveListId: string;
}

/** Strip `/branch-…` segments so all selections within a branch tree share
 *  one list id (in-place VirtualList update, scroll preserved). */
function listIdRoot(selected: string | null): string | null {
  return selected?.replace(/\/branch-[^/]+/g, "") ?? null;
}

/**
 * Manages per-agent transcript list identity and scroll reset.
 *
 * When `selected` changes (agent selection in swimlanes):
 * - Scrolls the container to top (unless `hasScrollTarget` is true, in which
 *   case the caller has a specific event to scroll to and we leave the
 *   container alone so the imperative scroll wins)
 */
export function useListPositionManager(
  baseListId: string,
  selected: string | null,
  scrollRef: RefObject<HTMLDivElement | null>,
  hasScrollTarget: boolean = false
): ListPositionManagerResult {
  const idSelection = useMemo(() => listIdRoot(selected), [selected]);
  const effectiveListId = useMemo(
    () => (idSelection ? `${baseListId}:${idSelection}` : baseListId),
    [baseListId, idSelection]
  );

  // Track previous values so the effect only fires on a real selection/list change
  const prevSelectedRef = useRef(selected);
  const prevBaseListIdRef = useRef(baseListId);

  // eslint-disable-next-line tsmono/no-raw-use-effect -- baselined at rule introduction; migrate to a named hook or derived state
  useEffect(() => {
    if (
      prevSelectedRef.current === selected &&
      prevBaseListIdRef.current === baseListId
    ) {
      return;
    }
    prevSelectedRef.current = selected;
    prevBaseListIdRef.current = baseListId;

    // Scroll to top for the new selection — unless the caller has a deep-link
    // target queued (e.g. URL `?event=` from branch-resolution navigation), in
    // which case we let the imperative scroll set the position.
    if (!hasScrollTarget) {
      scrollRef.current?.scrollTo({ top: 0 });
    }
  }, [selected, baseListId, scrollRef, hasScrollTarget]);

  return { effectiveListId };
}
