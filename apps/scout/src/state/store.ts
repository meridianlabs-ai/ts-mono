import { createContext, useContext } from "react";
import { create, type StateCreator } from "zustand";
import { createJSONStorage, devtools, persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

import { debounce } from "@tsmono/util";

import { ScoutApiV2 } from "../api/api";

import { createAppSlice, type AppSlice } from "./appSlice";
import {
  createComponentStateSlice,
  type ComponentStateSlice,
} from "./componentStateSlice";
import { createRoutingSlice, type RoutingSlice } from "./routingSlice";
import { createScanSlice, type ScanSlice } from "./scanSlice";
import { createScansSlice, type ScansSlice } from "./scansSlice";
import { createTranscriptSlice, type TranscriptSlice } from "./transcriptSlice";
import {
  createTranscriptsSlice,
  type TranscriptsSlice,
} from "./transcriptsSlice";
import { createValidationSlice, type ValidationSlice } from "./validationSlice";

export type {
  ColumnFilter,
  FilterType,
} from "@tsmono/inspect-components/columnFilter";
export type { ScansTableState } from "./scansSlice";
export type { TranscriptsTableState } from "./transcriptsSlice";

export interface StoreState
  extends
    AppSlice,
    RoutingSlice,
    ScansSlice,
    ScanSlice,
    ComponentStateSlice,
    TranscriptsSlice,
    TranscriptSlice,
    ValidationSlice {}

// Slices are written against the full store so cross-slice actions (the
// "clear when switching X" resets) can reach every field with the composed
// set/get; the mutator tuple mirrors the middleware chain in createStore.
export type StoreSlice<T> = StateCreator<
  StoreState,
  [
    ["zustand/devtools", never],
    ["zustand/persist", unknown],
    ["zustand/immer", never],
  ],
  [],
  T
>;

const createDebouncedPersistStorage = (
  storage: ReturnType<typeof createJSONStorage>,
  delay = 2000
) => {
  if (!storage) {
    throw new Error("Storage is required");
  }

  type StorageValue = Parameters<typeof storage.setItem>[1];

  const debouncedSetItem = debounce((key: string, value: StorageValue) => {
    storage.setItem(key, value);
  }, delay);

  return {
    ...storage,
    setItem: (key: string, value: StorageValue) => {
      debouncedSetItem(key, value);
    },
  };
};

export const createStore = (api: ScoutApiV2) =>
  create<StoreState>()(
    devtools(
      persist(
        immer((...args) => ({
          ...createAppSlice(...args),
          ...createRoutingSlice(...args),
          ...createScansSlice(...args),
          ...createScanSlice(...args),
          ...createComponentStateSlice(...args),
          ...createTranscriptsSlice(...args),
          ...createTranscriptSlice(...args),
          ...createValidationSlice(...args),
        })),
        {
          name: "inspect-scout-storage",
          storage: createDebouncedPersistStorage(
            createJSONStorage(() => api.storage)
          ),
          version: 1,
          partialize: (state) => {
            const {
              hasInitializedRouting,
              visibleScannerResults,
              ...persistedState
            } = state;
            return persistedState;
          },
        }
      )
    )
  );

type StoreApi = ReturnType<typeof createStore>;

const StoreContext = createContext<StoreApi | null>(null);
const ApiContext = createContext<ScoutApiV2 | null>(null);

export const StoreProvider = StoreContext.Provider;
export const ApiProvider = ApiContext.Provider;

const selectWholeState = (state: StoreState) => state;

export function useStore(): StoreState;
export function useStore<T>(selector: (state: StoreState) => T): T;
export function useStore<T>(selector?: (state: StoreState) => T) {
  // Named `use*` so React Compiler recognizes the call below as a hook. Under
  // any other name it treats `store(selector)` as a plain call and memoizes it
  // away, skipping zustand's useSyncExternalStore on later renders.
  const useBoundStore = useContext(StoreContext);
  if (!useBoundStore)
    throw new Error("useStore must be used within StoreProvider");

  return useBoundStore<T | StoreState>(selector ?? selectWholeState);
}

/**
 * The bound store itself, for one-shot `getState()` reads (a mount effect
 * that decides once) where a `useStore` selector would subscribe the
 * component to fields it never re-renders on.
 */
export const useStoreApi = (): StoreApi => {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useStoreApi must be used within StoreProvider");
  return store;
};

export const useApi = (): ScoutApiV2 => {
  const api = useContext(ApiContext);
  if (!api) throw new Error("useApi must be used within ApiProvider");
  return api;
};
