import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PendingSamples, SampleSummary } from "../client/api/types";

import { useSelectedPendingSamples, useSelectedSampleSummaries } from "./hooks";

// Thin wiring test: the binding reads the selection and delegates to the
// param-driven acquisition hook — mock both sides and assert the plumbing.
const usePendingSamples = vi.hoisted(() => vi.fn());
const useSampleSummaries = vi.hoisted(() => vi.fn());
vi.mock("../log_data", () => ({
  usePendingSamples,
  useSampleSummaries,
  useCachedSample: vi.fn(),
  useLogDetail: vi.fn(),
  useLogHandles: vi.fn(),
  useLogPreviews: vi.fn(),
  useRunningSample: vi.fn(),
  useSample: vi.fn(),
}));

vi.mock("../app_config", () => ({
  getApi: vi.fn(),
  useLogDir: () => "/logs",
}));

vi.mock("./store", () => ({
  useStore: (selector: (state: unknown) => unknown) =>
    selector({ logs: { selectedLogFile: "run.eval" } }),
}));

describe("useSelectedPendingSamples", () => {
  it("delegates to usePendingSamples with the selected log", () => {
    const pending = { samples: [], refresh: 2 } as unknown as PendingSamples;
    usePendingSamples.mockReturnValue(pending);

    const { result } = renderHook(() => useSelectedPendingSamples());

    expect(usePendingSamples).toHaveBeenCalledWith("/logs", "run.eval");
    expect(result.current).toBe(pending);
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
