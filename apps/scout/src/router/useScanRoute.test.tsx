// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { type PropsWithChildren } from "react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { encodeBase64Url } from "@tsmono/util";

import { useAppConfigAsync } from "../app/server/useAppConfig";
import { createAppConfig } from "../test/objectFactories";
import { server } from "../test/setup-msw";
import { createTestWrapperWithStore } from "../test/test-utils";
import type { AppConfig } from "../types/api-types";

import { kScanRouteUrlPattern, kScansRootRouteUrlPattern } from "./url";
import { useScanRoute } from "./useScanRoute";

afterEach(cleanup);

const serverScansDir = "/home/tester/project/scans";
const routeScansDir = "/mnt/other/scans";
const scanPath = "team/scan_id=3oUGqQCpPQ9WSNPV4oy7Fe";

// useScanRoute reads the loaded app config synchronously, so the route
// element mounts only once the real query has settled.
const AppConfigGate = ({ children }: PropsWithChildren) => {
  const { data } = useAppConfigAsync();
  return data ? <>{children}</> : null;
};

const renderAt = async (initialRoute: string) => {
  server.use(
    http.get("/api/v2/app-config", () =>
      HttpResponse.json<AppConfig>(createAppConfig())
    )
  );
  const { wrapper: Providers, store } = createTestWrapperWithStore();
  const wrapper = ({ children }: PropsWithChildren) => (
    <Providers>
      <AppConfigGate>
        <MemoryRouter initialEntries={[initialRoute]}>
          <Routes>
            <Route path={kScanRouteUrlPattern} element={children} />
            <Route path={kScansRootRouteUrlPattern} element={children} />
          </Routes>
        </MemoryRouter>
      </AppConfigGate>
    </Providers>
  );
  const { result } = renderHook(
    () => ({ route: useScanRoute(), navigate: useNavigate() }),
    { wrapper }
  );
  await waitFor(() => {
    expect(result.current).not.toBeNull();
  });
  return { result, store };
};

describe("useScanRoute", () => {
  it("decodes the route directory and resolves the scan location", async () => {
    const { result, store } = await renderAt(
      `/scan/${encodeBase64Url(routeScansDir)}/${scanPath}/8B90F1605892`
    );

    expect(result.current.route).toEqual({
      scansDir: routeScansDir,
      relativePath: `${scanPath}/8B90F1605892`,
      scanPath,
      scanResultUuid: "8B90F1605892",
      resolvedScansDir: routeScansDir,
      location: `${routeScansDir}/${scanPath}`,
    });
    expect(store.getState().userScansDir).toBe(routeScansDir);
  });

  it("falls back to the server directory when the route has none", async () => {
    const { result, store } = await renderAt("/scans");

    expect(result.current.route.scansDir).toBeUndefined();
    expect(result.current.route.resolvedScansDir).toBe(serverScansDir);
    expect(store.getState().userScansDir).toBeUndefined();
  });

  it("keeps the last route directory in the store after leaving the route", async () => {
    const { result, store } = await renderAt(
      `/scan/${encodeBase64Url(routeScansDir)}/${scanPath}`
    );
    expect(store.getState().userScansDir).toBe(routeScansDir);

    await act(async () => {
      await result.current.navigate("/scans");
    });

    expect(result.current.route.scansDir).toBeUndefined();
    expect(result.current.route.resolvedScansDir).toBe(serverScansDir);
    expect(store.getState().userScansDir).toBe(routeScansDir);
  });
});
