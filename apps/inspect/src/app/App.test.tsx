import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { initializeStore, storeImplementation } from "../state/store";

import { AppContent } from "./App";

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
