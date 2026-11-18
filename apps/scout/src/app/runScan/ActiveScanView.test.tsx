// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  WireActiveScanInfo,
  WireActiveScansResponse,
  WireScannerSummary,
} from "../../api/normalize";
import { createActiveScanInfo } from "../../test/objectFactories";
import { server } from "../../test/setup-msw";
import { createTestWrapper } from "../../test/test-utils";
import { useActiveScan } from "../server/useActiveScan";

import { ActiveScanView } from "./ActiveScanView";

// Spy rather than stub so tests without a mockReturnValue fetch through MSW
// and the real normalizer.
vi.mock("../server/useActiveScan", { spy: true });

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.resetAllMocks();
});

it("updates elapsed, remaining and batch age each second and stops on unmount", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:01:00Z"));
  const started = Date.now() / 1000 - 10;
  const info = createActiveScanInfo({
    scan_id: "clock-test",
    start_time: started,
    total_scans: 20,
  });
  info.metrics.completed_scans = 5;
  info.metrics.batch_oldest_created = started + 5;
  vi.mocked(useActiveScan).mockReturnValue({ loading: false, data: info });
  const { unmount } = render(<ActiveScanView scanId={info.scan_id} />);
  expect(screen.getByText("0:10")).toBeTruthy();
  expect(screen.getByText("0:30")).toBeTruthy();
  expect(screen.getByText("0:05")).toBeTruthy();
  await act(() => vi.advanceTimersByTime(1000));
  expect(screen.getByText("0:11")).toBeTruthy();
  expect(screen.getByText("0:33")).toBeTruthy();
  expect(screen.getByText("0:06")).toBeTruthy();
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});

// A plain-object summary, as React Query's structural sharing hands back.
it("shows a not-yet-started scanner named after an Object.prototype member", () => {
  const info = createActiveScanInfo({
    scan_id: "proto-names",
    scanner_names: ["constructor"],
    summary: { complete: false, scanners: {} },
  });
  vi.mocked(useActiveScan).mockReturnValue({ loading: false, data: info });
  render(<ActiveScanView scanId={info.scan_id} />);
  expect(screen.getByText("constructor")).toBeTruthy();
});

const renderActiveScan = (info: WireActiveScanInfo) => {
  server.use(
    http.get("/api/v2/scans/active", () =>
      HttpResponse.json<WireActiveScansResponse>({
        items: { [info.scan_id]: info },
      })
    )
  );
  return render(<ActiveScanView scanId={info.scan_id} />, {
    wrapper: createTestWrapper(),
  });
};

describe("unscored column", () => {
  const scanWith = (
    scanners: Record<string, WireScannerSummary>
  ): WireActiveScanInfo => ({
    ...createActiveScanInfo({
      scan_id: "unscored-test",
      scanner_names: Object.keys(scanners),
    }),
    summary: { complete: false, scanners },
  });

  const withoutUnscored = [
    "scanner",
    "results",
    "errors",
    "tokens/scan",
    "tokens",
  ];

  const columnHeaders = async () => {
    const table = await screen.findByRole("table");
    return within(table)
      .getAllByRole("columnheader")
      .map((th) => th.textContent);
  };

  it("is hidden when no scanner has unscored results", async () => {
    renderActiveScan(
      scanWith({
        alpha: { results: 3, errors: 0, unscored: 0, metrics: null },
        beta: { results: 1, errors: 2, unscored: 0, metrics: null },
      })
    );
    expect(await columnHeaders()).toEqual(withoutUnscored);
  });

  it("is hidden for a summary written before the unscored count existed", async () => {
    renderActiveScan(
      scanWith({ alpha: { results: 3, errors: 1, metrics: null } })
    );
    expect(await columnHeaders()).toEqual(withoutUnscored);
  });

  it("appears after results when any scanner has unscored results", async () => {
    renderActiveScan(
      scanWith({
        alpha: { results: 3, errors: 0, unscored: 0, metrics: null },
        beta: { results: 1, errors: 2, unscored: 7, metrics: null },
      })
    );
    expect(await columnHeaders()).toEqual([
      "scanner",
      "results",
      "unscored",
      "errors",
      "tokens/scan",
      "tokens",
    ]);

    const cellsFor = (scanner: string) =>
      within(screen.getByRole("row", { name: new RegExp(`^${scanner}\\b`) }))
        .getAllByRole("cell")
        .map((td) => td.textContent);
    expect(cellsFor("alpha")).toEqual(["alpha", "3", "-", "-", "-", "-"]);
    expect(cellsFor("beta")).toEqual(["beta", "1", "7", "2", "-", "-"]);
  });
});
