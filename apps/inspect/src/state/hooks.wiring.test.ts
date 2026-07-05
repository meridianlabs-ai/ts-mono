import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RunningMetric, SampleSummary } from "../client/api/types";
import { LogDataState } from "../log_data";

import { useSelectedRunningMetrics, useSelectedSampleSummaries } from "./hooks";
import {
  useSelectedLogDetail,
  useSelectedLogLoading,
} from "./selectedLogDetails";

// Thin wiring test: the binding reads the selection and delegates to the
// param-driven acquisition hook — mock both sides and assert the plumbing.
const useLogDetail = vi.hoisted(() => vi.fn());
const useRunningMetrics = vi.hoisted(() => vi.fn());
const useSampleSummaries = vi.hoisted(() => vi.fn());
vi.mock("../log_data", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../log_data")>()),
  useLogDetail,
  useRunningMetrics,
  useSampleSummaries,
}));

vi.mock("../app_config", () => ({
  getApi: vi.fn(),
  useLogDir: () => "/logs",
}));

// Mutable so the "no file selected" test (e) can override selectedLogFile.
const storeState: { selectedLogFile: string | undefined } = vi.hoisted(() => ({
  selectedLogFile: "run.eval",
}));
vi.mock("./store", () => ({
  useStore: (selector: (state: unknown) => unknown) =>
    selector({ logs: { selectedLogFile: storeState.selectedLogFile } }),
}));

beforeEach(() => {
  storeState.selectedLogFile = "run.eval";
});

describe("useSelectedRunningMetrics", () => {
  it("delegates to useRunningMetrics with the selected log", () => {
    const metrics: RunningMetric[] = [];
    useRunningMetrics.mockReturnValue(metrics);

    const { result } = renderHook(() => useSelectedRunningMetrics());

    expect(useRunningMetrics).toHaveBeenCalledWith("/logs", "run.eval");
    expect(result.current).toBe(metrics);
  });
});

describe("useSelectedLogDetail", () => {
  it("delegates to useLogDetail with the selected log", () => {
    const state: LogDataState<unknown> = {
      data: undefined,
      loading: true,
      error: undefined,
    };
    useLogDetail.mockReturnValue(state);
    storeState.selectedLogFile = "run.eval";

    const { result } = renderHook(() => useSelectedLogDetail());

    // Active demand: the selection binding is the one consumer that must
    // bump the settle seq / trigger a background refresh (see F2 in
    // fetchEngine.test.ts's "passive vs active demand" suite).
    expect(useLogDetail).toHaveBeenCalledWith("/logs", "run.eval", {
      demand: "active",
    });
    expect(result.current).toBe(state);
  });
});

describe("useSelectedLogLoading", () => {
  it("is false when no file is selected", () => {
    useLogDetail.mockReturnValue({
      data: undefined,
      loading: false,
      error: undefined,
    });
    storeState.selectedLogFile = undefined;

    const { result } = renderHook(() => useSelectedLogLoading());

    expect(result.current).toBe(false);
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
