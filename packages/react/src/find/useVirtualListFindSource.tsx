import {
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";

import type { VirtualListHandle } from "../virtual/types";

import { useOptionalFindSnapshot, useRegisterFindSource } from "./FindContext";
import type { FindSegment, FindSource } from "./types";
import { useFindCorpus } from "./useFindCorpus";

export interface UseVirtualListFindSourceOptions<T> {
  items: readonly T[];
  /** Must be the SAME renderer the live list uses, and referentially stable
   *  (a fresh lambda per render would rebuild the corpus every notify). */
  renderRow: (index: number, item: T) => ReactNode;
  listHandle: RefObject<VirtualListHandle | null>;
  /** Scroll container hosting the live rows; scopes element lookup away from
   *  the offscreen probe and roots the controller's mutation observer.
   *  Without it the source counts matches but cannot paint them. */
  scrollRef?: RefObject<HTMLElement | null>;
  /** Stable per-item key. Defaults to the list index, which is only valid
   *  for append-only lists — pass a real key when items re-sort or filter. */
  keyOf?: (item: T, index: number) => string;
  /** Identity of everything the row's rendered text depends on. Defaults to
   *  the item itself. */
  cacheKeyOf?: (item: T, index: number) => unknown;
}

interface VirtualCorpusItem<T> {
  key: string;
  item: T;
  index: number;
}

/** Registers any VirtualList as a find source: rows render through the
 *  list's own renderRow into the offscreen probe, reveal is a virtualizer
 *  index scroll. Returns the probe node for the caller to render. */
export function useVirtualListFindSource<T>(
  options: UseVirtualListFindSourceOptions<T>
): ReactNode {
  const { items, renderRow, listHandle, scrollRef, keyOf, cacheKeyOf } =
    options;

  const corpusItems = useMemo<VirtualCorpusItem<T>[]>(
    () =>
      items.map((item, index) => ({
        key: keyOf ? keyOf(item, index) : String(index),
        item,
        index,
      })),
    [items, keyOf]
  );

  const snapshot = useOptionalFindSnapshot();
  const corpusKeyOf = useMemo(() => (c: VirtualCorpusItem<T>) => c.key, []);
  const corpusCacheKeyOf = useMemo(
    () => (c: VirtualCorpusItem<T>) =>
      cacheKeyOf ? cacheKeyOf(c.item, c.index) : [c.item, renderRow],
    [cacheKeyOf, renderRow]
  );
  const renderItem = useMemo(
    () => (c: VirtualCorpusItem<T>) => renderRow(c.index, c.item),
    [renderRow]
  );
  const { segments, prefixSegments, probe } = useFindCorpus<
    VirtualCorpusItem<T>
  >({
    items: corpusItems,
    keyOf: corpusKeyOf,
    cacheKeyOf: corpusCacheKeyOf,
    renderItem,
    active: snapshot.active,
  });

  // Key → current index, for element lookup and reveal after re-sorts.
  const indexByKey = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of corpusItems) map.set(c.key, c.index);
    return map;
  }, [corpusItems]);
  const indexByKeyRef = useRef(indexByKey);
  useEffect(() => {
    indexByKeyRef.current = indexByKey;
  }, [indexByKey]);

  const segmentsRef = useRef<readonly FindSegment[] | null>(null);
  const prefixRef = useRef<readonly FindSegment[]>([]);
  const listenersRef = useRef(new Set<() => void>());
  useEffect(() => {
    segmentsRef.current = segments;
    // Notify per extraction batch too: the controller lands match 1 (and
    // extends steppable range) from the growing prefix while counting.
    prefixRef.current = prefixSegments;
    for (const listener of listenersRef.current) listener();
  }, [segments, prefixSegments]);

  const source = useMemo<FindSource>(
    () => ({
      getSegments: () => segmentsRef.current,
      getPrefixSegments: () => prefixRef.current,
      subscribe: (listener) => {
        listenersRef.current.add(listener);
        return () => listenersRef.current.delete(listener);
      },
      reveal: (key, onSettled) => {
        const handle = listHandle.current;
        const index = indexByKeyRef.current.get(key);
        if (!handle || index === undefined) {
          // Remount window (tab/view switch) or item filtered away: nothing
          // to scroll — release the controller's centering gate instead.
          onSettled();
          return;
        }
        handle.scrollToIndex({
          index,
          align: "center",
          behavior: "auto",
          onDone: onSettled,
        });
      },
      getContainer: () => scrollRef?.current ?? null,
      getElement: (key) => {
        const index = indexByKeyRef.current.get(key);
        if (index === undefined) return null;
        return (
          scrollRef?.current?.querySelector<HTMLElement>(
            `[data-item-index="${index}"]`
          ) ?? null
        );
      },
      cleanup: () => undefined,
    }),
    [listHandle, scrollRef]
  );
  useRegisterFindSource(source);

  return probe;
}
