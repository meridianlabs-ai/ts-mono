// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
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
        unscored: 0,
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
const serve = (scanIds: string[], { listed = true } = {}) => {
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
      statuses[scanId] ??= status;
      if (listed) {
        active[scanId] = createActiveScanInfo({
          scan_id: scanId,
          title: `running ${scanId}`,
          scanner_names: ["llm_scanner"],
        });
      }
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

const outcome = () => screen.getByRole("status").textContent;

const scannerRow = (scanner: string) =>
  within(screen.getByRole("row", { name: new RegExp(`^${scanner}\\b`) }))
    .getAllByRole("cell")
    .map((td) => td.textContent);

const nextPoll = () => act(() => vi.advanceTimersByTimeAsync(kPollMs));

const startListedScan = async (scanIds: string[]) => {
  const api = serve(scanIds);
  renderPanel();
  await runScan();
  await nextPoll();
  await screen.findByText("running scanA");
  expect(screen.getByText("workers")).toBeTruthy();
  return api;
};

it("keeps the scan's card with its final results and a link to them", async () => {
  const api = await startListedScan(["scanA"]);

  api.finish("scanA", finishedStatus("scanA"));
  await nextPoll();

  await screen.findByRole("status");
  expect(outcome()).toBe("Complete");
  // Same card, now filled from the final status; the live-only worker stats go.
  expect(screen.getByText("running scanA")).toBeTruthy();
  expect(scannerRow("llm_scanner")).toEqual([
    "llm_scanner",
    "7",
    "-",
    "-",
    "-",
  ]);
  expect(screen.queryByText("workers")).toBeNull();

  fireEvent.click(screen.getByRole("link", { name: "View results" }));
  await screen.findByText(
    `scan page /scan/${encodeBase64Url(scansDir)}/scan_id=scanA`
  );
});

it("counts errors in the outcome of a complete scan", async () => {
  const api = await startListedScan(["scanA"]);

  const status = finishedStatus("scanA");
  const scanner = status.summary.scanners.llm_scanner;
  if (scanner) scanner.errors = 2;
  api.finish("scanA", status);
  await nextPoll();

  await screen.findByRole("status");
  expect(outcome()).toBe("Complete · 2 errors");
  expect(scannerRow("llm_scanner")).toEqual([
    "llm_scanner",
    "7",
    "2",
    "-",
    "-",
  ]);
});

it("says incomplete when the scan left the list without completing", async () => {
  const api = await startListedScan(["scanA"]);

  api.finish("scanA", startedStatus("scanA"));
  await nextPoll();

  await screen.findByRole("status");
  expect(outcome()).toBe("Incomplete");
  // No final summary yet: the rows come from the last active entry.
  expect(scannerRow("llm_scanner")[0]).toBe("llm_scanner");
});

it("reports an incomplete scan with errors and eventually stops polling", async () => {
  const api = await startListedScan(["scanA"]);

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
          unscored: 0,
        },
      },
    },
  });
  await nextPoll();

  await screen.findByRole("status");
  expect(outcome()).toBe("Incomplete · 3 errors");

  // An incomplete status is re-checked for a while, then polling stops.
  for (let i = 0; i < 20; i++) await nextPoll();
  const requests = api.statusRequests();
  await nextPoll();
  await nextPoll();
  expect(api.statusRequests()).toBe(requests);
});

it("updates the outcome when the summary is written after the scan left the list", async () => {
  const api = await startListedScan(["scanA"]);

  api.finish("scanA", startedStatus("scanA"));
  await nextPoll();
  await screen.findByRole("status");
  expect(outcome()).toBe("Incomplete");

  api.finish("scanA", finishedStatus("scanA"));
  await nextPoll();
  await waitFor(() => expect(outcome()).toBe("Complete"));
  expect(scannerRow("llm_scanner")).toEqual([
    "llm_scanner",
    "7",
    "-",
    "-",
    "-",
  ]);
});

it("shows a scan that finished before the active list ever showed it", async () => {
  const api = serve(["scanA"], { listed: false });
  api.finish("scanA", finishedStatus("scanA"));
  renderPanel();
  await runScan();
  await nextPoll();

  await screen.findByRole("status");
  expect(outcome()).toBe("Complete");
  expect(screen.getByText("scan: scanA")).toBeTruthy();
  expect(scannerRow("llm_scanner")).toEqual([
    "llm_scanner",
    "7",
    "-",
    "-",
    "-",
  ]);
});

it("replaces the finished card when another scan starts", async () => {
  const api = await startListedScan(["scanA", "scanB"]);
  api.finish("scanA", finishedStatus("scanA"));
  await nextPoll();
  await screen.findByRole("status");

  fireEvent.click(button("Run Scan"));
  await nextPoll();

  await screen.findByText("running scanB");
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.queryByText("running scanA")).toBeNull();
});
