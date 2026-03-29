import { useCallback } from "react";

import { ComponentStateHooks } from "@tsmono/react/state";

import { useStore } from "./store";

export const scoutStateHooks: ComponentStateHooks = {
  // Property bag
  usePropertyValue: (id: string, prop: string, defaultValue?: unknown) =>
    useStore(
      useCallback(
        (state) => state.getPropertyValue(id, prop, defaultValue),
        [id, prop, defaultValue]
      )
    ),
  useSetPropertyValue: () => useStore((state) => state.setPropertyValue),
  useRemovePropertyValue: () => useStore((state) => state.removePropertyValue),

  // Bucketed booleans
  useBucketValue: (bucket: string, id: string) =>
    useStore((state) => state.collapsedBuckets[bucket]?.[id]),
  useSetBucketValue: () => useStore((state) => state.setCollapsed),
  useBucketEntries: (bucket: string) =>
    useStore((state) => state.collapsedBuckets[bucket]),
  useClearBucket: () => useStore((state) => state.clearCollapsed),

  // Scroll positions
  useGetScrollPosition: () => useStore((state) => state.getScrollPosition),
  useSetScrollPosition: () => useStore((state) => state.setScrollPosition),

  // Virtuoso list state
  useListPosition: (key: string) =>
    useStore(useCallback((state) => state.listPositions[key], [key])),
  useSetListPosition: () => useStore((state) => state.setListPosition),
  useClearListPosition: () => useStore((state) => state.clearListPosition),

  // Visible ranges
  useVisibleRanges: () => useStore((state) => state.visibleRanges),
  useSetVisibleRange: () => {
    const setVisibleRange = useStore((state) => state.setVisibleRange);
    return useCallback(
      (key: string, value: { startIndex: number; endIndex: number }) => {
        setVisibleRange(key, { ...value, totalCount: 0 });
      },
      [setVisibleRange]
    );
  },
};
