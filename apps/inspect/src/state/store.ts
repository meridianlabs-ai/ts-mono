import { enableMapSet } from "immer";
import { createContext, useContext } from "react";
import { create, StoreApi, UseBoundStore } from "zustand";
import { devtools, persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

import { createLogger, debounce } from "@tsmono/util";

import { Capabilities, ClientAPI, ClientStorage } from "../client/api/types";
import { createDatabaseService, DatabaseService } from "../client/database";

import { AppSlice, createAppSlice, initializeAppSlice } from "./appSlice";
import { createLogSlice, initalializeLogSlice, LogSlice } from "./logSlice";
import { createLogsSlice, initializeLogsSlice, LogsSlice } from "./logsSlice";
import { setSamplePollingApi } from "./samplePollingInstance";
import {
  createSampleSlice,
  handleRehydrate,
  initializeSampleSlice,
  SampleSlice,
} from "./sampleSlice";
import { createSearchSlice, SearchSlice } from "./searchSlice";
import { filterState } from "./store_filter";
import { ReplicationService } from "./sync/replicationService";

const log = createLogger("store");

export interface StoreState
  extends AppSlice, LogsSlice, LogSlice, SampleSlice, SearchSlice {
  // The shared database service
  databaseService?: DatabaseService | null;

  // The shared replication service
  replicationService?: ReplicationService | null;

  // Global actions
  initialize: (capabilities: Capabilities) => void;
  cleanup: () => void;
}

export let storeImplementation: UseBoundStore<StoreApi<StoreState>> | null =
  null;

// The data that will actually be persisted
export type PersistedState = {
  app: AppSlice["app"];
  log: LogSlice["log"];
  logs: LogsSlice["logs"];
  sample: SampleSlice["sample"];
};

// Create a proxy store that forwards calls to the real store once initialized
export const useStore = ((selector?: any) => {
  if (!storeImplementation) {
    throw new Error(
      "Store accessed before initialization. Call initializeStore first."
    );
  }
  return selector ? storeImplementation(selector) : storeImplementation();
}) as UseBoundStore<StoreApi<StoreState>>;

// Initialize the store
export const initializeStore = (
  api: ClientAPI,
  capabilities: Capabilities,
  storage?: ClientStorage
) => {
  enableMapSet();

  // Create the storage implementation
  const storageImplementation = {
    getItem: <T>(name: string): T | null => {
      return storage ? (storage.getItem(name) as T) : null;
    },
    setItem: debounce(<T>(name: string, value: T): void => {
      if (storage) {
        const wrapper = value as { state: PersistedState; version: number };
        const filtered = {
          state: filterState(wrapper.state),
          version: wrapper.version,
        };
        storage.setItem(name, filtered);
      }
    }, 1000),
    removeItem: (name: string): void => {
      if (storage) {
        storage.removeItem(name);
      }
    },
  };

  // Create the actual store
  const store = create<StoreState>()(
    devtools(
      persist(
        immer((set, get, store) => {
          const [appSlice, appCleanup] = createAppSlice(
            set as (fn: (state: StoreState) => void) => void,
            get,
            store
          );
          const [logsSlice, logsCleanup] = createLogsSlice(
            set as (fn: (state: StoreState) => void) => void,
            get,
            store,
            api
          );
          const [logSlice, logCleanup] = createLogSlice(
            set as (fn: (state: StoreState) => void) => void,
            get,
            store,
            api
          );
          const [sampleSlice, sampleCleanup] = createSampleSlice(
            set as (fn: (state: StoreState) => void) => void,
            get,
            store
          );
          const [searchSlice, searchCleanup] = createSearchSlice(
            set as (fn: (state: StoreState) => void) => void
          );

          // Create a shared database service instance
          const databaseService = createDatabaseService();

          // The replication service
          const replicationService = new ReplicationService();

          return {
            // Shared state
            databaseService,
            replicationService,

            // Initialize
            initialize: (capabilities) => {
              set((state) => {
                state.databaseService = databaseService;
                state.replicationService = replicationService;
              });

              // Initialize application slices
              initializeAppSlice(
                set as (fn: (state: StoreState) => void) => void,
                capabilities
              );
              initializeLogsSlice(
                set as (fn: (state: StoreState) => void) => void
              );
              initalializeLogSlice(
                set as (fn: (state: StoreState) => void) => void
              );
              initializeSampleSlice(
                set as (fn: (state: StoreState) => void) => void
              );
            },

            // Create the slices and merge them in
            ...appSlice,
            ...logsSlice,
            ...logSlice,
            ...sampleSlice,
            ...searchSlice,

            cleanup: async () => {
              // Close database before cleaning up slices
              await databaseService.closeDatabase();

              appCleanup();
              logsCleanup();
              logCleanup();
              sampleCleanup();
              searchCleanup();
            },
          };
        }),
        {
          name: "app-storage",
          storage: storageImplementation,
          partialize: (state) =>
            ({
              app: { ...state.app, rehydrated: true },
              log: state.log,
              logs: state.logs,
              sample: state.sample,
            }) as unknown as StoreState,
          version: 4,
          onRehydrateStorage: (state: StoreState) => {
            return (hydrationState, error) => {
              handleRehydrate(state);
              log.debug("REHYDRATING STATE");
              if (error) {
                log.debug("ERROR", { error });
              } else {
                log.debug("STATE", { state, hydrationState });
              }
            };
          },
        }
      )
    )
  );

  // Set the implementation and initialize it
  storeImplementation = store as UseBoundStore<StoreApi<StoreState>>;
  setSamplePollingApi(api);
  store.getState().initialize(capabilities);
};

const ApiContext = createContext<ClientAPI | null>(null);

export const ApiProvider = ApiContext.Provider;

export const useApi = (): ClientAPI => {
  const api = useContext(ApiContext);
  if (!api) throw new Error("useApi must be used within ApiProvider");
  return api;
};
