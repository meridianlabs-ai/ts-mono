// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { type PropsWithChildren } from "react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { encodeBase64Url } from "@tsmono/util";

import {
  kScanRouteUrlPattern,
  kScansRootRouteUrlPattern,
} from "../../router/url";
import { createAppConfig, createStatus } from "../../test/objectFactories";
import { server } from "../../test/setup-msw";
import { createTestWrapperWithStore } from "../../test/test-utils";
import type { AppConfig, Status } from "../../types/api-types";
import { useAppConfigAsync } from "../server/useAppConfig";

import { useSelectedScan } from "./useSelectedScan";

afterEach(cleanup);

const scansDir = "/home/tester/project/scans";
const scanPath = "team/scan_id=3oUGqQCpPQ9WSNPV4oy7Fe";
const status = createStatus({ location: `${scansDir}/${scanPath}` });

// useScanRoute reads the loaded app config synchronously, so the route
// element mounts only once the real query has settled.
const AppConfigGate = ({ children }: PropsWithChildren) => {
  const { data } = useAppConfigAsync();
  return data ? <>{children}</> : null;
};

const renderAt = async (initialRoute: string) => {
  let scanRequests = 0;
  server.use(
    http.get("/api/v2/app-config", () =>
      HttpResponse.json<AppConfig>(
        createAppConfig({ scans: { dir: scansDir, source: "project" } })
      )
    ),
    http.get(
      `/api/v2/scans/${encodeBase64Url(scansDir)}/${encodeBase64Url(scanPath)}`,
      () => {
        scanRequests += 1;
        return HttpResponse.json<Status>(status);
      }
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
    () => ({ scan: useSelectedScan(), navigate: useNavigate() }),
    { wrapper }
  );
  await waitFor(() => {
    expect(result.current).not.toBeNull();
  });
  return { result, store, scanRequests: () => scanRequests };
};

describe("useSelectedScan", () => {
  it("loads the routed scan and remembers its location for route restoration", async () => {
    const { result, store } = await renderAt(
      `/scan/${encodeBase64Url(scansDir)}/${scanPath}`
    );

    expect(store.getState().selectedScanLocation).toBe(scanPath);
    await waitFor(() => {
      expect(result.current.scan.data).toEqual(status);
    });
  });

  it("fetches nothing and leaves the store alone on the scans root", async () => {
    const { result, store, scanRequests } = await renderAt("/scans");

    expect(result.current.scan.data).toBeUndefined();
    expect(scanRequests()).toBe(0);
    expect(store.getState().selectedScanLocation).toBeUndefined();
  });

  it("keeps the last scan location after leaving the scan route", async () => {
    const { result, store } = await renderAt(
      `/scan/${encodeBase64Url(scansDir)}/${scanPath}`
    );
    expect(store.getState().selectedScanLocation).toBe(scanPath);

    await act(async () => {
      await result.current.navigate("/scans");
    });

    expect(result.current.scan.data).toBeUndefined();
    expect(store.getState().selectedScanLocation).toBe(scanPath);
  });
});
