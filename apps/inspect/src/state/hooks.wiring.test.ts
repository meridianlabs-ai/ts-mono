import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { loading } from "@tsmono/util";

import { RunningMetric, SampleSummary } from "../client/api/types";

import { useSelectedRunningMetrics, useSelectedSampleSummaries } from "./hooks";
import { useSelectedLogQuery } from "./selectedLogDetails";

// Thin wiring test: the binding reads the selection and delegates to the
// param-driven acquisition hook — mock both sides and assert the plumbing.
const useLogDetailQuery = vi.hoisted(() => vi.fn());
const useRunningMetrics = vi.hoisted(() => vi.fn());
const useSampleSummaries = vi.hoisted(() => vi.fn());
vi.mock("../log_data", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../log_data")>()),
  useLogDetailQuery,
  useRunningMetrics,
  useSampleSummaries,
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

describe("useSelectedLogQuery", () => {
  it("delegates to useLogDetailQuery with the selected log", () => {
    useLogDetailQuery.mockReturnValue(loading);

    const { result } = renderHook(() => useSelectedLogQuery());

    expect(useLogDetailQuery).toHaveBeenCalledWith("/logs", "run.eval");
    expect(result.current).toBe(loading);
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
