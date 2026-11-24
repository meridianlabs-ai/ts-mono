// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getAppRouter } from "./app/routing/AppRouter";
import {
  testClientAPI,
  testLogDetails,
  testSampleSummary,
} from "./client/api/testClientApi";
import {
  useLogSelection,
  useSelectedSampleSummary,
  useSelectedScores,
} from "./embed";
import { storeImplementation } from "./state/store";
import { atRoute, startTestApp, stopTestApp } from "./test/testApp";

// The embedder's chrome renders outside the viewer's RouterProvider; these
// hooks follow the viewer's own (hash) router directly.
const navigate = (path: string) =>
  act(async () => {
    await getAppRouter().navigate(path);
  });
const wrapper = atRoute();

beforeEach(async () => {
  // Every log holds samples one/1 and two/2.
  startTestApp({
    logDir: "file:///logs",
    api: testClientAPI({
      get_log_details: () =>
        Promise.resolve(
          testLogDetails({
            sampleSummaries: [
              testSampleSummary({ id: "one", epoch: 1 }),
              testSampleSummary({ id: "two", epoch: 2 }),
            ],
          })
        ),
    }),
  });
  await navigate("/logs/run.eval/samples/sample/one/1");
});
afterEach(async () => {
  cleanup();
  await stopTestApp();
});

describe("embedding hooks outside RouterProvider", () => {
  it("exposes selected scores without a router context", () => {
    const { result } = renderHook(useSelectedScores, { wrapper });
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
    const { result } = renderHook(useLogSelection, { wrapper });
    expect(result.current.logFile).toBe("file:///logs/run.eval");
    // The summaries and header arrive through the engine's details fetch.
    await waitFor(() =>
      expect(result.current.loadedLog).toBe("file:///logs/run.eval")
    );
    expect(result.current.sample?.id).toBe("one");
    await navigate("/tasks/other.eval/samples/sample/two/2");
    expect(result.current.logFile).toBe("file:///logs/other.eval");
    await waitFor(() => expect(result.current.sample?.id).toBe("two"));
    await act(async () => {
      await getAppRouter().navigate(-1);
    });
    expect(result.current.sample?.id).toBe("one");
    await navigate("/logs");
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
    const { result } = renderHook(useSelectedSampleSummary, { wrapper });
    await waitFor(() => expect(result.current?.id).toBe("one"));
    await navigate("/logs/run.eval/samples");
    expect(result.current?.id).toBe("two");
    await navigate("/logs/other.eval/samples");
    expect(result.current).toBeUndefined();
    await navigate("/logs/run.eval/samples/sample/one/invalid");
    expect(result.current).toBeUndefined();
    await navigate("/logs/run.eval/samples/sample_uuid/pending");
    expect(result.current).toBeUndefined();
  });
});
