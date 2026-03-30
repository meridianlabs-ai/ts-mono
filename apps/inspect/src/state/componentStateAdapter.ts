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
  usePropertyEntries: (id: string) =>
    useStore(useCallback((state) => state.app.propertyBags[id], [id])),
  useRemoveAllProperties: () =>
    useStore((state) => state.appActions.removeAllProperties),
};
