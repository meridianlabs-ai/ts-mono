import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { getVscodeApi } from "@tsmono/util";

import { getBootstrap } from "./app_config";
import { App } from "./app/App";
import { Capabilities } from "./client/api/types";
import storage from "./client/storage";
import { initializeStore, storeImplementation } from "./state/store";

// No api instance exists yet — construction needs the resolved log dir
// (below the gate). The backend's transport facts are a sync bootstrap fact.
const backendCapabilities = getBootstrap().backend.capabilities;
const applicationStorage = storage;

// Application capabilities
const vscode = getVscodeApi();
const capabilities: Capabilities = {
  downloadFiles: true,
  downloadLogs: backendCapabilities.downloadLogs,
  webWorkers: true,
  streamSamples: backendCapabilities.streamSamples,
};

// Initial state / storage
if (vscode) {
  // Adjust capabilities
  const extensionVersionEl = document.querySelector(
    'meta[name="inspect-extension:version"]'
  );
  const extensionVersion = extensionVersionEl
    ? extensionVersionEl.getAttribute("content")
    : undefined;

  capabilities.downloadFiles = false;
  if (!extensionVersion) {
    capabilities.webWorkers = false;
  }
}

// Inititialize the application store
initializeStore(capabilities, applicationStorage);

// Determine whether we need to restore a stored hash
restoreHash();

// Find the root element and render into it
const containerId = "app";
const container = document.getElementById(containerId);
if (!container) {
  console.error("Root container not found");
  throw new Error(
    `Expected a container element with Id '${containerId}' but no such container element was present.`
  );
}

// Render into the root
const root = createRoot(container);
root.render(
  <StrictMode>
    <App />
  </StrictMode>
);

function restoreHash() {
  // Check if we need to restore a route
  if (storeImplementation && storeImplementation.getState().app.urlHash) {
    const storedHash = storeImplementation.getState().app.urlHash;
    if (storedHash) {
      // Directly set the window location hash if there is
      // a stored hash that needs to be restored
      if (storedHash.startsWith("/")) {
        window.location.hash = storedHash;
      } else if (storedHash.startsWith("#")) {
        window.location.hash = storedHash;
      } else {
        window.location.hash = "#" + storedHash;
      }
    }
  }
}
