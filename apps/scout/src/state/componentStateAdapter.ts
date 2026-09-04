import { useCallback } from "react";

import { ComponentStateHooks } from "@tsmono/react/state";
import { getOwn } from "@tsmono/util";

import { useStore } from "./store";

export const scoutStateHooks: ComponentStateHooks = {
  useValue: (id: string, prop: string, defaultValue?: unknown) =>
    useStore(
      useCallback(
        (state) => state.getPropertyValue(id, prop, defaultValue),
        [id, prop, defaultValue]
      )
    ),
  useSetValue: () => useStore((state) => state.setPropertyValue),
  useRemoveValue: () => useStore((state) => state.removePropertyValue),
  useEntries: (id: string) =>
    useStore(useCallback((state) => getOwn(state.properties, id), [id])),
  useRemoveAll: () => useStore((state) => state.removeAllProperties),
  useRemoveByPrefix: () => useStore((state) => state.removeByPrefix),
};
