import { useCallback } from "react";

import { ComponentStateHooks } from "@tsmono/react/state";

import { useStore } from "./store";

export const inspectStateHooks: ComponentStateHooks = {
  // Property bag
  usePropertyValue: (id: string, prop: string, defaultValue?: unknown) =>
    useStore(
      useCallback(
        (state) => state.appActions.getPropertyValue(id, prop, defaultValue),
        [id, prop, defaultValue]
      )
    ),
  useSetPropertyValue: () =>
    useStore((state) => state.appActions.setPropertyValue),
  useRemovePropertyValue: () =>
    useStore((state) => state.appActions.removePropertyValue),

  // Bucketed booleans — inspect uses flat composite keys for collapsed state
  useBucketValue: (bucket: string, id: string) => {
    const stateId = bucket ? `${bucket}-${id}` : id;
    return useStore(
      useCallback(
        (state) => {
          const value = state.app.collapsed[stateId];
          return value as boolean | undefined;
        },
        [stateId]
      )
    );
  },
  useSetBucketValue: () => {
    const setCollapsed = useStore((state) => state.appActions.setCollapsed);
    const collapseId = useStore((state) => state.sampleActions.collapseId);
    return useCallback(
      (bucket: string, id: string, value: boolean) => {
        // Write to both stores — useCollapsedState reads from app.collapsed
        // (flat composite keys) while useCollapsibleIds reads from
        // sample.collapsedIdBuckets (nested buckets).
        const stateId = bucket ? `${bucket}-${id}` : id;
        setCollapsed(stateId, value);
        collapseId(bucket, id, value);
      },
      [setCollapsed, collapseId]
    );
  },
  useBucketEntries: (key: string) =>
    useStore(
      useCallback((state) => state.sample.collapsedIdBuckets[key], [key])
    ),
  useClearBucket: () =>
    useStore((state) => state.sampleActions.clearCollapsedIds),

  // Scroll positions
  useGetScrollPosition: () =>
    useStore((state) => state.appActions.getScrollPosition),
  useSetScrollPosition: () =>
    useStore((state) => state.appActions.setScrollPosition),

  // Virtuoso list state
  useListPosition: (key: string) =>
    useStore(useCallback((state) => state.app.listPositions[key], [key])),
  useSetListPosition: () =>
    useStore((state) => state.appActions.setListPosition),
  useClearListPosition: () =>
    useStore((state) => state.appActions.clearListPosition),

  // Visible ranges
  useVisibleRanges: () => useStore((state) => state.app.visibleRanges),
  useSetVisibleRange: () =>
    useStore((state) => state.appActions.setVisibleRange),
};
