import { getOwn } from "@tsmono/util";

import { emptyDataframeState, type DataframeState } from "./dataframeState";
import type { StoreSlice } from "./store";

// Per-component persisted UI state keyed by component id (see
// componentStateAdapter.ts), plus the dataframe grid states.
export interface ComponentStateSlice {
  properties: Record<string, Record<string, unknown> | undefined>;
  gridStates: Record<string, DataframeState>;

  setPropertyValue: (id: string, propertyName: string, value: unknown) => void;
  // Persisted component state: what was stored is whatever a component put
  // there, so it comes back as `unknown` for the caller to narrow.
  getPropertyValue: (
    id: string,
    propertyName: string,
    defaultValue?: unknown
  ) => unknown;
  removePropertyValue: (id: string, propertyName: string) => void;
  removeAllProperties: (id: string) => void;
  removeByPrefix: (id: string, prefix: string) => void;

  setGridState: (
    name: string,
    state: DataframeState | ((previous: DataframeState) => DataframeState)
  ) => void;
}

export const createComponentStateSlice: StoreSlice<ComponentStateSlice> = (
  set,
  get
) => ({
  properties: {},
  gridStates: {},

  setPropertyValue(id: string, propertyName: string, value: unknown) {
    set((state) => {
      const group = getOwn(state.properties, id);
      if (group !== undefined && propertyName !== "__proto__") {
        group[propertyName] = value;
        return;
      }
      // Computed keys bypass the inherited __proto__ setter, which
      // Immer rejects even when the draft already owns that property.
      const next = { ...group, [propertyName]: value };
      if (id === "__proto__") {
        state.properties = { ...state.properties, [id]: next };
      } else {
        state.properties[id] = next;
      }
    });
  },
  getPropertyValue(
    id: string,
    propertyName: string,
    defaultValue: unknown
  ): unknown {
    const group = getOwn(get().properties, id);
    const value =
      group !== undefined && Object.hasOwn(group, propertyName)
        ? group[propertyName]
        : undefined;
    return value !== undefined ? value : defaultValue;
  },
  removePropertyValue(id: string, propertyName: string) {
    set((state) => {
      const propertyGroup = getOwn(state.properties, id);

      if (!propertyGroup || !Object.hasOwn(propertyGroup, propertyName)) {
        return;
      }

      delete propertyGroup[propertyName];
      if (Object.keys(propertyGroup).length === 0) {
        delete state.properties[id];
      }
    });
  },
  removeAllProperties(id: string) {
    set((state) => {
      delete state.properties[id];
    });
  },
  removeByPrefix(id: string, prefix: string) {
    set((state) => {
      const bag = getOwn(state.properties, id);
      if (!bag) return;
      let changed = false;
      for (const key of Object.keys(bag)) {
        if (key.startsWith(prefix)) {
          delete bag[key];
          changed = true;
        }
      }
      if (changed && Object.keys(bag).length === 0) {
        delete state.properties[id];
      }
    });
  },
  setGridState: (name, gridState) => {
    set((state) => {
      state.gridStates[name] =
        typeof gridState === "function"
          ? gridState(state.gridStates[name] ?? emptyDataframeState)
          : gridState;
    });
  },
});
