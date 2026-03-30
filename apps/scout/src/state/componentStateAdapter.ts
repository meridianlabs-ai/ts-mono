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
  usePropertyEntries: (id: string) =>
    useStore(useCallback((state) => state.properties[id], [id])),
  useRemoveAllProperties: () => useStore((state) => state.removeAllProperties),
};
