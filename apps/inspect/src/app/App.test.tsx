import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { initializeStore, storeImplementation } from "../state/store";

import { AppContent } from "./App";

const getVscodeApi = vi.hoisted(() => vi.fn());
vi.mock("@tsmono/util", async (original) => ({
  ...(await original<typeof import("@tsmono/util")>()),
  getVscodeApi,
}));

const setLogRoot = vi.hoisted(() => vi.fn());
vi.mock("../app_config", async (original) => ({
  ...(await original<typeof import("../app_config")>()),
  setLogRoot,
}));

// Only the host-message bridge is under test: stub the router and the fetch
// engine so <AppContent> mounts on its own.
vi.mock("react-router/dom", () => ({ RouterProvider: () => null }));
vi.mock("./routing/AppRouter.tsx", () => ({ AppRouter: {} }));

const invalidateLogListing = vi.hoisted(() => vi.fn());
vi.mock("../log_data", () => ({
  FetchEngineController: () => null,
  imperativeLogData: { invalidateLogListing },
}));

afterEach(() => {
  cleanup();
  document.getElementById("logview-state")?.remove();
  getVscodeApi.mockReset();
  setLogRoot.mockReset();
  vi.restoreAllMocks();
});

it("backgroundUpdate refreshes the listing and leaves the selected log alone", () => {
  initializeStore({
    downloadFiles: false,
    downloadLogs: false,
    webWorkers: false,
    streamSamples: false,
  });
  const store = storeImplementation;
  if (!store) throw new Error("store not initialized");
  store.getState().logsActions.setSelectedLogFile("file:///logs/open.eval");
  // The host posts backgroundUpdate while the webview is unfocused.
  vi.spyOn(document, "hasFocus").mockReturnValue(false);
  render(<AppContent />);

  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "backgroundUpdate",
          url: "/logs/new.eval",
          log_dir: "file:///logs",
        },
      })
    );
  });

  expect(store.getState().logs.selectedLogFile).toBe("file:///logs/open.eval");
  expect(invalidateLogListing).toHaveBeenCalledTimes(1);
});

it("does not trust runtime updates from any MessageEvent source", () => {
  getVscodeApi.mockReturnValue({
    postMessage: vi.fn(),
    getState: vi.fn(),
    setState: vi.fn(),
  });
  initializeStore({
    downloadFiles: false,
    downloadLogs: false,
    webWorkers: false,
    streamSamples: false,
  });
  render(<AppContent />);

  const frame = document.createElement("iframe");
  document.body.appendChild(frame);
  act(() => {
    for (const source of [null, frame.contentWindow]) {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "updateState", url: "/logs/untrusted.eval" },
          source,
        })
      );
    }
  });

  expect(setLogRoot).not.toHaveBeenCalled();
  frame.remove();
});

it("accepts the injected VS Code startup state", () => {
  getVscodeApi.mockReturnValue({
    postMessage: vi.fn(),
    getState: vi.fn(),
    setState: vi.fn(),
  });
  initializeStore({
    downloadFiles: false,
    downloadLogs: false,
    webWorkers: false,
    streamSamples: false,
  });
  const embedded = document.createElement("script");
  embedded.id = "logview-state";
  embedded.type = "application/json";
  embedded.textContent = JSON.stringify({
    type: "updateState",
    url: "/logs/startup.eval",
  });
  document.body.appendChild(embedded);

  render(<AppContent />);

  expect(setLogRoot).toHaveBeenCalledWith("/logs");
});
