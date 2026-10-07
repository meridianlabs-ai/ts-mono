// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { data } from "@tsmono/util";

import { testLogHeader, testSampleSummary } from "./client/api/testClientApi";
import {
  useLogSelection,
  useSelectedSampleSummary,
  useSelectedScores,
} from "./embed";
import { initializeStore, storeImplementation } from "./state/store";

let router: ReturnType<typeof createMemoryRouter>;
vi.mock("./app/routing/AppRouter", () => ({ getAppRouter: () => router }));
vi.mock("./app_config", () => ({
  useLogDir: () => "file:///logs",
  resolveRouteLogFile: (path: string) => new URL(path, "file:///logs/").href,
}));
vi.mock("./log_data", () => ({
  useSampleSummaries: (_dir: string, file: string | undefined) =>
    data(
      file
        ? [
            testSampleSummary({ id: "one", epoch: 1 }),
            testSampleSummary({ id: "two", epoch: 2 }),
          ]
        : []
    ),
  useLogHeader: (_dir: string, file: string | undefined) =>
    data(file ? testLogHeader() : undefined),
}));
beforeEach(() => {
  initializeStore({
    downloadFiles: false,
    downloadLogs: false,
    webWorkers: false,
    streamSamples: false,
  });
  router = createMemoryRouter([{ path: "*", element: null }], {
    initialEntries: ["/logs/run.eval/samples/sample/one/1"],
  });
});
afterEach(() => {
  cleanup();
  router.dispose();
});

describe("embedding hooks outside RouterProvider", () => {
  it("exposes selected scores without a router context", () => {
    const { result } = renderHook(useSelectedScores);
    expect(result.current).toEqual([]);
    act(() => {
      storeImplementation
        ?.getState()
        .logActions.setSelectedScores([
          { name: "accuracy", scorer: "correct" },
        ]);
    });
    expect(result.current).toEqual([{ name: "accuracy", scorer: "correct" }]);
  });
  it("follows the actual router on navigation and Back", async () => {
    const { result } = renderHook(useLogSelection);
    expect(result.current.logFile).toBe("file:///logs/run.eval");
    expect(result.current.sample?.id).toBe("one");
    expect(result.current.loadedLog).toBe("file:///logs/run.eval");
    await act(async () => {
      await router.navigate("/tasks/other.eval/samples/sample/two/2");
    });
    expect(result.current.logFile).toBe("file:///logs/other.eval");
    expect(result.current.sample?.id).toBe("two");
    await act(async () => {
      await router.navigate(-1);
    });
    expect(result.current.sample?.id).toBe("one");
    await act(async () => {
      await router.navigate("/logs");
    });
    expect(result.current).toEqual({
      logFile: undefined,
      sample: undefined,
      loadedLog: undefined,
    });
  });
  it("allows a same-log row preview but never lets it override an explicit destination", async () => {
    storeImplementation
      ?.getState()
      .logActions.highlightSample("two", 2, "file:///logs/run.eval");
    const { result } = renderHook(useSelectedSampleSummary);
    expect(result.current?.id).toBe("one");
    await act(async () => {
      await router.navigate("/logs/run.eval/samples");
    });
    expect(result.current?.id).toBe("two");
    await act(async () => {
      await router.navigate("/logs/other.eval/samples");
    });
    expect(result.current).toBeUndefined();
    await act(async () => {
      await router.navigate("/logs/run.eval/samples/sample/one/invalid");
    });
    expect(result.current).toBeUndefined();
    await act(async () => {
      await router.navigate("/logs/run.eval/samples/sample_uuid/pending");
    });
    expect(result.current).toBeUndefined();
  });
});
