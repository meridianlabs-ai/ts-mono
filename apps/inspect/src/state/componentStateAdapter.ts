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

  // Collapsed state — inspect uses flat composite keys
  useCollapsedValue: (id: string, scope?: string) => {
    const stateId = scope ? `${scope}-${id}` : id;
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
  useSetCollapsed: () => {
    const fn = useStore((state) => state.appActions.setCollapsed);
    return useCallback(
      (scope: string, id: string, value: boolean) => {
        const stateId = scope ? `${scope}-${id}` : id;
        fn(stateId, value);
      },
      [fn]
    );
  },

  // Collapsed ID buckets — inspect uses sample.collapsedIdBuckets
  useCollapsedIds: (key: string) =>
    useStore(
      useCallback((state) => state.sample.collapsedIdBuckets[key], [key])
    ),
  useCollapseId: () => useStore((state) => state.sampleActions.collapseId),
  useClearCollapsedIds: () =>
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

  // Popover visibility
  usePopoverValue: () => useStore((state) => state.sample.visiblePopover),
  useSetPopover: () =>
    useStore((state) => state.sampleActions.setVisiblePopover),
  useClearPopover: () =>
    useStore((state) => state.sampleActions.clearVisiblePopover),
};
