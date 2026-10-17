// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { type PropsWithChildren } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { decodeBase64Url, encodeBase64Url } from "@tsmono/util";

import { kScanRouteUrlPattern } from "../../router/url";
import {
  createActiveScanInfo,
  createAppConfig,
  createStatus,
} from "../../test/objectFactories";
import { server } from "../../test/setup-msw";
import { createTestWrapper } from "../../test/test-utils";
import { button, innerTextarea, onlyElement } from "../../test/webComponents";
import type {
  ActiveScanInfo,
  ActiveScansResponse,
  AppConfig,
  ScannersResponse,
  Status,
} from "../../types/api-types";
import { useAppConfigAsync } from "../server/useAppConfig";

import { RunScanPanel } from "./RunScanPanel";

// Vite defines this build flag; the navbars' activity list reads it at import.
vi.hoisted(() => vi.stubGlobal("__SCOUT_RUN_SCAN__", true));

const scansDir = "/home/tester/project/scans";
const kPollMs = 5000;

// Fake timers drive the 5s active-scans poll; shouldAdvanceTime keeps
// waitFor/findBy polling.
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  // The navbar's theme toggle reads this; jsdom lacks it.
  vi.stubGlobal("matchMedia", (query: string): MediaQueryList =>
    Object.assign(new EventTarget(), {
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
    })
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const startedStatus = (scanId: string): Status =>
  createStatus({
    // The server reports it relative to its working directory.
    location: `scans/scan_id=${scanId}`,
    spec: { ...createStatus().spec, scan_id: scanId },
  });

const finishedStatus = (
  scanId: string,
  overrides: Partial<Status> = {}
): Status => ({
  ...startedStatus(scanId),
  complete: true,
  summary: {
    complete: true,
    scanners: {
      llm_scanner: {
        errors: 0,
        metrics: null,
        model_usage: {},
        results: 7,
        scans: 10,
        tokens: 0,
      },
    },
  },
  ...overrides,
});

/**
 * Serves the Run Scan page. Each "Run Scan" click starts the next id in
 * `scanIds`; the test moves scans in and out of the active list and sets
 * what each scan's status endpoint returns.
 */
const serve = (scanIds: string[]) => {
  const active: Record<string, ActiveScanInfo> = {};
  const statuses: Record<string, Status> = {};
  let started = 0;
  let statusRequests = 0;
  server.use(
    http.get("/api/v2/app-config", () =>
      HttpResponse.json<AppConfig>(
        createAppConfig({ scans: { dir: scansDir, source: "project" } })
      )
    ),
    http.get("/api/v2/scanners", () =>
      HttpResponse.json<ScannersResponse>({
        items: [{ name: "inspect_scout/llm_scanner", params: [], version: 0 }],
      })
    ),
    http.get("/api/v2/scans/active", () =>
      HttpResponse.json<ActiveScansResponse>({ items: active })
    ),
    http.post("/api/v2/startscan", () => {
      const scanId = scanIds[started++];
      if (!scanId) throw new Error("Started more scans than the test scripted");
      const status = startedStatus(scanId);
      statuses[scanId] = status;
      active[scanId] = createActiveScanInfo({
        scan_id: scanId,
        title: `running ${scanId}`,
      });
      return HttpResponse.json<Status>(status);
    }),
    http.get<{ scanPath: string }>(
      `/api/v2/scans/${encodeBase64Url(scansDir)}/:scanPath`,
      ({ params }) => {
        statusRequests++;
        const scanId = decodeBase64Url(params.scanPath).replace("scan_id=", "");
        const status = statuses[scanId];
        if (!status) throw new Error(`No status for scan ${scanId}`);
        return HttpResponse.json<Status>(status);
      }
    )
  );
  return {
    finish: (scanId: string, status: Status) => {
      Reflect.deleteProperty(active, scanId);
      statuses[scanId] = status;
    },
    statusRequests: () => statusRequests,
  };
};

const AppConfigGate = ({ children }: PropsWithChildren) => {
  const { data } = useAppConfigAsync();
  return data ? <>{children}</> : null;
};

const ScanPage = () => <div>scan page {useLocation().pathname}</div>;

const renderPanel = () => {
  const Providers = createTestWrapper();
  render(
    <Providers>
      <AppConfigGate>
        <MemoryRouter initialEntries={["/run"]}>
          <Routes>
            <Route path="/run" element={<RunScanPanel />} />
            <Route path={kScanRouteUrlPattern} element={<ScanPage />} />
          </Routes>
        </MemoryRouter>
      </AppConfigGate>
    </Providers>
  );
};

const runScan = async () => {
  await screen.findByText("No scan started");
  // The question field mounts once the scanner list has loaded.
  const question = await waitFor(() =>
    innerTextarea(onlyElement("vscode-textarea"))
  );
  fireEvent.input(question, { target: { value: "Did the agent give up?" } });
  fireEvent.click(button("Run Scan"));
};

const queryNotice = () =>
  screen.queryByRole("status") ?? screen.queryByRole("alert");

const nextPoll = () => act(() => vi.advanceTimersByTimeAsync(kPollMs));

it("replaces a finished scan with a notice linking to its results", async () => {
  const api = serve(["scanA"]);
  renderPanel();
  await runScan();
  await nextPoll();
  await screen.findByText("running scanA");

  api.finish("scanA", finishedStatus("scanA"));
  await nextPoll();

  const notice = await screen.findByRole("status");
  expect(notice.textContent).toContain("Scan complete");
  expect(notice.textContent).toContain("7 results, 0 errors");
  expect(screen.queryByText("running scanA")).toBeNull();

  fireEvent.click(screen.getByRole("link", { name: "View results" }));
  await screen.findByText(
    `scan page /scan/${encodeBase64Url(scansDir)}/scan_id=scanA`
  );
});

it("shows the error style when the scan finished with errors", async () => {
  const api = serve(["scanA"]);
  renderPanel();
  await runScan();
  await nextPoll();
  await screen.findByText("running scanA");

  const status = finishedStatus("scanA");
  const scanner = status.summary.scanners.llm_scanner;
  if (scanner) scanner.errors = 2;
  api.finish("scanA", status);
  await nextPoll();

  const notice = await screen.findByRole("alert");
  expect(notice.textContent).toContain("Scan complete with errors");
  expect(notice.textContent).toContain("7 results, 2 errors");
  expect(screen.queryByRole("status")).toBeNull();
});

it("shows the error style when the scan left the list without completing", async () => {
  const api = serve(["scanA"]);
  renderPanel();
  await runScan();
  await nextPoll();
  await screen.findByText("running scanA");

  api.finish("scanA", startedStatus("scanA"));
  await nextPoll();

  const notice = await screen.findByRole("alert");
  expect(notice.textContent).toContain("Scan ended without completing");
});

it("says a scan with errors finished with errors and eventually stops polling", async () => {
  const api = serve(["scanA"]);
  renderPanel();
  await runScan();
  await nextPoll();
  await screen.findByText("running scanA");

  api.finish("scanA", {
    ...finishedStatus("scanA"),
    complete: false,
    summary: {
      complete: false,
      scanners: {
        llm_scanner: {
          errors: 3,
          metrics: null,
          model_usage: {},
          results: 0,
          scans: 3,
          tokens: 0,
        },
      },
    },
  });
  await nextPoll();

  const notice = await screen.findByRole("alert");
  expect(notice.textContent).toContain("Scan finished with errors");
  expect(notice.textContent).toContain("3 errors");

  // An incomplete status is re-checked for a while, then polling stops.
  for (let i = 0; i < 20; i++) await nextPoll();
  const requests = api.statusRequests();
  await nextPoll();
  await nextPoll();
  expect(api.statusRequests()).toBe(requests);
});

it("corrects the notice when the summary is written after the scan left the list", async () => {
  const api = serve(["scanA"]);
  renderPanel();
  await runScan();
  await nextPoll();
  await screen.findByText("running scanA");

  api.finish("scanA", startedStatus("scanA"));
  await nextPoll();
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Scan ended without completing"
  );

  api.finish("scanA", finishedStatus("scanA"));
  await nextPoll();
  expect((await screen.findByRole("status")).textContent).toContain(
    "Scan complete"
  );
});

it("keeps the notice until dismissed", async () => {
  const api = serve(["scanA"]);
  renderPanel();
  await runScan();
  await nextPoll();
  await screen.findByText("running scanA");
  api.finish("scanA", finishedStatus("scanA"));
  await nextPoll();
  await screen.findByRole("status");

  await nextPoll();
  expect(screen.getByRole("status").textContent).toContain("Scan complete");

  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(queryNotice()).toBeNull();
  await screen.findByText("No scan started");
});

it("clears the notice when another scan starts", async () => {
  const api = serve(["scanA", "scanB"]);
  renderPanel();
  await runScan();
  await nextPoll();
  await screen.findByText("running scanA");
  api.finish("scanA", finishedStatus("scanA"));
  await nextPoll();
  await screen.findByRole("status");

  fireEvent.click(button("Run Scan"));
  await nextPoll();

  await screen.findByText("running scanB");
  expect(queryNotice()).toBeNull();
});
