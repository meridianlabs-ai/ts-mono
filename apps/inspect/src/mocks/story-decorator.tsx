import type { Decorator } from "@storybook/react";

import { App } from "../app/App";
import { clientApi } from "../client/api/client-api";
import { viewServerApi } from "../client/api/view-server/api-view-server";
import type { Capabilities, ClientStorage } from "../client/api/types";
import { initializeStore } from "../state/store";

// Mirrors production capabilities. webWorkers must stay true so the IndexedDB
// replication path initializes — the overview route's syncLogs throws
// "No database available" otherwise. The zip worker it also enables is only
// exercised by .eval files, and these stories serve JSON logs.
const capabilities: Capabilities = {
  downloadFiles: false,
  downloadLogs: false,
  webWorkers: true,
  streamSamples: true,
  streamSampleData: true,
};

/**
 * Boots the real <App/> against MSW-intercepted network responses.
 * Reads `parameters.initialRoute` (default: "/logs") to position the
 * hash router before React renders.
 */
export const withMockedApp: Decorator = (_Story, context) => {
  const initialRoute: string = context.parameters.initialRoute ?? "/logs";

  // Fresh in-memory storage per render prevents cross-story state bleed
  const storageMap = new Map<string, unknown>();
  const storage: ClientStorage = {
    getItem: (name) => storageMap.get(name) ?? null,
    setItem: (name, value) => storageMap.set(name, value),
    removeItem: (name) => storageMap.delete(name),
  };

  const api = clientApi(viewServerApi(), undefined, false);

  // Re-initialize every render — each call replaces the module-level storeImplementation
  initializeStore(api, capabilities, storage);

  window.location.hash = initialRoute.startsWith("#")
    ? initialRoute
    : `#${initialRoute}`;

  return <App key={context.id} api={api} />;
};
