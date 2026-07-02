import { useSyncExternalStore } from "react";

import { fetchEngine, FetchEngineStatus } from "./fetchEngine";

/**
 * The fetch engine's status (background syncing activity + local database
 * stats), read reactively from the engine's own external store — it's
 * high-frequency ephemeral service status, not UI state or fetched server
 * data, so neither zustand nor react-query is involved.
 */
export const useFetchEngineStatus = (): FetchEngineStatus =>
  useSyncExternalStore(fetchEngine.subscribeStatus, fetchEngine.getStatus);
