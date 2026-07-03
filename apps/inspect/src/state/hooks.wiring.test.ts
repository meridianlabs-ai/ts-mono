import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RunningMetric, SampleSummary } from "../client/api/types";

import { useSelectedRunningMetrics, useSelectedSampleSummaries } from "./hooks";

// Thin wiring test: the binding reads the selection and delegates to the
// param-driven acquisition hook — mock both sides and assert the plumbing.
const useRunningMetrics = vi.hoisted(() => vi.fn());
const useSampleSummaries = vi.hoisted(() => vi.fn());
vi.mock("../log_data", () => ({
  useRunningMetrics,
  useSampleSummaries,
  useLogDetail: vi.fn(),
  useLogHandles: vi.fn(),
  useLogPreviews: vi.fn(),
  useSampleData: vi.fn(),
  useSampleInvalidation: vi.fn(),
}));

vi.mock("../app_config", () => ({
  getApi: vi.fn(),
  useLogDir: () => "/logs",
}));

vi.mock("./store", () => ({
  useStore: (selector: (state: unknown) => unknown) =>
    selector({ logs: { selectedLogFile: "run.eval" } }),
}));

describe("useSelectedRunningMetrics", () => {
  it("delegates to useRunningMetrics with the selected log", () => {
    const metrics: RunningMetric[] = [];
    useRunningMetrics.mockReturnValue(metrics);

    const { result } = renderHook(() => useSelectedRunningMetrics());

    expect(useRunningMetrics).toHaveBeenCalledWith("/logs", "run.eval");
    expect(result.current).toBe(metrics);
  });
});

describe("useSelectedSampleSummaries", () => {
  it("delegates to useSampleSummaries with the selected log", () => {
    const summaries: SampleSummary[] = [];
    useSampleSummaries.mockReturnValue(summaries);

    const { result } = renderHook(() => useSelectedSampleSummaries());

    expect(useSampleSummaries).toHaveBeenCalledWith("/logs", "run.eval");
    expect(result.current).toBe(summaries);
  });
});
