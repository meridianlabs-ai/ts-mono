// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { createActiveScanInfo, createStatus } from "../../test/objectFactories";
import { createTestWrapper } from "../../test/test-utils";
import { useActiveScan } from "../server/useActiveScan";

import { ActiveScanView } from "./ActiveScanView";

vi.mock("../server/useActiveScan");

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.resetAllMocks();
});

it("updates elapsed, remaining and batch age each second and stops on unmount", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:01:00Z"));
  const started = Date.now() / 1000 - 10;
  const scan = createStatus();
  const info = createActiveScanInfo({
    scan_id: scan.spec.scan_id,
    start_time: started,
    total_scans: 20,
  });
  info.metrics.completed_scans = 5;
  info.metrics.batch_oldest_created = started + 5;
  vi.mocked(useActiveScan).mockReturnValue({ loading: false, data: info });
  const { unmount } = render(
    <ActiveScanView scan={scan} scansDir="/scans" onDismiss={() => {}} />,
    { wrapper: createTestWrapper() }
  );
  expect(screen.getByText("0:10")).toBeTruthy();
  expect(screen.getByText("0:30")).toBeTruthy();
  expect(screen.getByText("0:05")).toBeTruthy();
  await act(() => vi.advanceTimersByTime(1000));
  expect(screen.getByText("0:11")).toBeTruthy();
  expect(screen.getByText("0:33")).toBeTruthy();
  expect(screen.getByText("0:06")).toBeTruthy();
  unmount();
  // Flush React Query's zero-gcTime cache eviction so only a leaked clock
  // interval would remain.
  vi.advanceTimersByTime(0);
  expect(vi.getTimerCount()).toBe(0);
});
