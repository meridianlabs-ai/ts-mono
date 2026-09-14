// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Outlet, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { apiScoutServer } from "../api/api-scout-server";
import { createStore, StoreProvider } from "../state/store";

import { scanResultRoute, scanRoute } from "./url";
import { useRestoreLastRoute } from "./useRestoreLastRoute";

const serverScansDir = "/home/tester/project/scans";
const userScansDir = "/mnt/other/scans";
const scanLocation = "team/scan_id=3oUGqQCpPQ9WSNPV4oy7Fe";
const scanResultUuid = "8B90F1605892";

afterEach(() => {
  cleanup();
  window.location.hash = "";
});

const Layout = () => {
  useRestoreLastRoute(serverScansDir);
  return <Outlet />;
};

const LocationProbe = () => {
  const { pathname } = useLocation();
  return <output data-testid="pathname">{pathname}</output>;
};

const createSeededStore = (seed: {
  selectedScanLocation?: string;
  displayedScanResult?: string;
  userScansDir?: string;
}) => {
  const store = createStore(apiScoutServer());
  store.setState(seed);
  return store;
};

// The hook decides from window.location.hash (what a hash router shows on
// first load), so the jsdom hash is pointed at the route the MemoryRouter
// starts on.
const renderAt = (
  initialRoute: string,
  store: ReturnType<typeof createStore>
) => {
  window.location.hash = initialRoute;
  return render(
    <StoreProvider value={store}>
      <MemoryRouter initialEntries={[initialRoute]}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="*" element={<LocationProbe />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </StoreProvider>
  );
};

const pathname = () => screen.getByTestId("pathname").textContent;

describe("useRestoreLastRoute", () => {
  it("replaces a default route with the last selected scan", () => {
    renderAt(
      "/scans",
      createSeededStore({ selectedScanLocation: scanLocation })
    );

    expect(pathname()).toBe(scanRoute(serverScansDir, scanLocation));
  });

  it("restores the last displayed scan result when there is one", () => {
    renderAt(
      "/",
      createSeededStore({
        selectedScanLocation: scanLocation,
        displayedScanResult: scanResultUuid,
      })
    );

    expect(pathname()).toBe(
      scanResultRoute(serverScansDir, scanLocation, scanResultUuid)
    );
  });

  it("prefers the user's scans directory over the server's", () => {
    renderAt(
      "/transcripts",
      createSeededStore({ selectedScanLocation: scanLocation, userScansDir })
    );

    expect(pathname()).toBe(scanRoute(userScansDir, scanLocation));
  });

  it("leaves a non-default route alone", () => {
    renderAt(
      "/project",
      createSeededStore({ selectedScanLocation: scanLocation })
    );

    expect(pathname()).toBe("/project");
  });

  it("stays put when no scan was selected", () => {
    const store = createSeededStore({});
    renderAt("/scans", store);

    expect(pathname()).toBe("/scans");
    expect(store.getState().hasInitializedRouting).toBe(true);
  });

  it("runs only once per store, even when the layout remounts", () => {
    const store = createSeededStore({ selectedScanLocation: scanLocation });
    const { unmount } = renderAt("/scans", store);
    expect(pathname()).toBe(scanRoute(serverScansDir, scanLocation));

    unmount();
    renderAt("/scans", store);

    expect(pathname()).toBe("/scans");
  });
});
