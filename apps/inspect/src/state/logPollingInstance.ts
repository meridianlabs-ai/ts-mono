import { ClientAPI } from "../client/api/types";

import { createLogPolling } from "./logPolling";
import { storeImplementation } from "./store";

let instance: ReturnType<typeof createLogPolling> | null = null;
let injectedApi: ClientAPI | null = null;

/**
 * Records the api that the polling singleton should use. Called from
 * initializeStore so the singleton stays consistent with the api the
 * consumer passed into the App tree.
 */
export function setLogPollingApi(api: ClientAPI) {
  injectedApi = api;
}

/**
 * Get the singleton log polling instance.
 * Lazily creates the instance on first access.
 */
export function getLogPolling() {
  if (!instance) {
    if (!storeImplementation) {
      throw new Error("Store must be initialized before accessing logPolling");
    }
    if (!injectedApi) {
      throw new Error(
        "logPolling api must be set via setLogPollingApi before accessing logPolling"
      );
    }
    const store = storeImplementation;
    instance = createLogPolling(
      () => store.getState(),
      (fn) => store.setState(fn),
      injectedApi
    );
  }
  return instance;
}

/**
 * Cleanup the log polling instance.
 * Should be called when the store is cleaned up.
 */
export function cleanupLogPolling() {
  if (instance) {
    instance.cleanup();
    instance = null;
  }
  injectedApi = null;
}
