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

type StatusError = Status["errors"][number];

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

const scanError = (transcriptId: string): StatusError => ({
  error: "model unavailable",
  refusal: false,
  scanner: "llm_scanner",
  traceback: "",
  transcript_id: transcriptId,
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
const serve = (
  scanIds: string[],
  {
    listed = true,
    configScansDir = scansDir,
    absoluteLocation,
  }: {
    /** Whether a started scan appears in the active list. */
    listed?: boolean;
    /** The app config's scans dir, e.g. one passed to `scout view --scans`. */
    configScansDir?: string;
    /** Report started scans at this absolute dir instead of `scans/` relative to the project. */
    absoluteLocation?: string;
  } = {}
) => {
  const active: Record<string, ActiveScanInfo> = {};
  const statuses: Record<string, Status> = {};
  let started = 0;
  let statusRequests = 0;
  let statusFails = false;
  const listScan = (scanId: string) => {
    active[scanId] = createActiveScanInfo({
      scan_id: scanId,
      title: `running ${scanId}`,
      scanner_names: ["llm_scanner"],
    });
  };
  server.use(
    http.get("/api/v2/app-config", () =>
      HttpResponse.json<AppConfig>(
        createAppConfig({ scans: { dir: configScansDir, source: "cli" } })
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
      if (listed) listScan(scanId);
      return HttpResponse.json<Status>(
        absoluteLocation
          ? { ...status, location: `${absoluteLocation}/scan_id=${scanId}` }
          : status
      );
    }),
    http.get<{ scanPath: string }>(
      `/api/v2/scans/${encodeBase64Url(absoluteLocation ?? scansDir)}/:scanPath`,
      ({ params }) => {
        statusRequests++;
        if (statusFails) return new HttpResponse(null, { status: 500 });
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
    /** Puts a scan back in the active list, as resuming it does. */
    relist: listScan,
    failStatusRequests: () => {
      statusFails = true;
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

it("counts outstanding errors, not ones a resumed scan has since retried", async () => {
  const api = await startListedScan(["scanA"]);

  // Scout's scanner counters keep errors a resume retried; its errors list
  // holds only the outstanding ones.
  const status = finishedStatus("scanA");
  const scanner = status.summary.scanners.llm_scanner;
  if (scanner) scanner.errors = 2;
  api.finish("scanA", status);
  await nextPoll();

  await screen.findByRole("status");
  expect(outcome()).toBe("Complete");
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
    errors: [scanError("t1"), scanError("t2"), scanError("t3")],
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
  const first = api.statusRequests();
  await nextPoll();
  expect(api.statusRequests()).toBeGreaterThan(first);
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

it("finds the scan where the server wrote it, not in the configured scans dir", async () => {
  const api = serve(["scanA"], { configScansDir: "/archive" });
  renderPanel();
  await runScan();
  await nextPoll();
  await screen.findByText("running scanA");

  api.finish("scanA", finishedStatus("scanA"));
  await nextPoll();

  await screen.findByRole("status");
  expect(outcome()).toBe("Complete");
  fireEvent.click(screen.getByRole("link", { name: "View results" }));
  await screen.findByText(
    `scan page /scan/${encodeBase64Url(scansDir)}/scan_id=scanA`
  );
});

it("finds a scan whose location the server reports as absolute", async () => {
  const api = serve(["scanA"], { absoluteLocation: "/data/scans" });
  renderPanel();
  await runScan();
  await nextPoll();
  await screen.findByText("running scanA");

  api.finish("scanA", finishedStatus("scanA"));
  await nextPoll();

  await screen.findByRole("status");
  expect(outcome()).toBe("Complete");
  fireEvent.click(screen.getByRole("link", { name: "View results" }));
  await screen.findByText(
    `scan page /scan/${encodeBase64Url("/data/scans")}/scan_id=scanA`
  );
});

it("shows a scan that failed before the active list ever showed it", async () => {
  const api = serve(["scanA"], { listed: false });
  api.finish("scanA", { ...startedStatus("scanA"), errors: [scanError("t1")] });
  renderPanel();
  await runScan();
  await nextPoll();

  await screen.findByRole("status");
  expect(outcome()).toBe("Incomplete · 1 error");
  expect(screen.queryByText("Scan not found")).toBeNull();
});

it("keeps the finished card through a failed status poll", async () => {
  const api = await startListedScan(["scanA"]);
  // Incomplete, so the status keeps being polled.
  api.finish("scanA", { ...startedStatus("scanA"), errors: [scanError("t1")] });
  await nextPoll();
  await screen.findByRole("status");

  api.failStatusRequests();
  const requests = api.statusRequests();
  await nextPoll();
  await nextPoll();

  expect(api.statusRequests()).toBeGreaterThan(requests);
  expect(outcome()).toBe("Incomplete · 1 error");
  expect(screen.getByRole("link", { name: "View results" })).toBeTruthy();
  expect(screen.queryByText("Error Loading Scan Results")).toBeNull();
});

it("stops polling a status that keeps failing", async () => {
  const api = await startListedScan(["scanA"]);
  api.failStatusRequests();
  api.finish("scanA", finishedStatus("scanA"));
  await nextPoll();
  await screen.findByText("Error Loading Scan Results");

  for (let i = 0; i < 20; i++) await nextPoll();
  const requests = api.statusRequests();
  await nextPoll();
  await nextPoll();
  expect(api.statusRequests()).toBe(requests);
});

it("goes back to the live card when a finished scan is resumed", async () => {
  const api = await startListedScan(["scanA"]);
  api.finish("scanA", startedStatus("scanA"));
  await nextPoll();
  await screen.findByRole("status");
  expect(outcome()).toBe("Incomplete");

  api.relist("scanA");
  await nextPoll();
  await screen.findByText("workers");
  expect(screen.queryByRole("status")).toBeNull();
  // Longer than the finished status is polled for.
  for (let i = 0; i < 20; i++) await nextPoll();

  api.finish("scanA", finishedStatus("scanA"));
  await nextPoll();
  await screen.findByRole("status");
  expect(outcome()).toBe("Complete");
});
