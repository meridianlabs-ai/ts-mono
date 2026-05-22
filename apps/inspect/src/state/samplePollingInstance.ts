import { ClientAPI } from "../client/api/types";

import { createSamplePolling } from "./samplePolling";
import { storeImplementation } from "./store";

let instance: ReturnType<typeof createSamplePolling> | null = null;
let injectedApi: ClientAPI | null = null;

/**
 * Records the api that the polling singleton should use. Called from
 * initializeStore so the singleton stays consistent with the api the
 * consumer passed into the App tree.
 */
export function setSamplePollingApi(api: ClientAPI) {
  injectedApi = api;
}

/**
 * Get the singleton sample polling instance.
 * Lazily creates the instance on first access.
 */
export function getSamplePolling() {
  if (!instance) {
    if (!storeImplementation) {
      throw new Error(
        "Store must be initialized before accessing samplePolling"
      );
    }
    if (!injectedApi) {
      throw new Error(
        "samplePolling api must be set via setSamplePollingApi before accessing samplePolling"
      );
    }
    instance = createSamplePolling(storeImplementation, injectedApi);
  }
  return instance;
}

/**
 * Cleanup the sample polling instance.
 * Should be called when the store is cleaned up.
 */
export function cleanupSamplePolling() {
  if (instance) {
    instance.cleanup();
    instance = null;
  }
  injectedApi = null;
}
