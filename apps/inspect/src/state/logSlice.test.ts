import { afterEach, describe, expect, it, vi } from "vitest";

import { initializeStore, storeImplementation } from "./store";
import { testStoreState } from "./testStore";

const capabilities = {
  downloadFiles: false,
  downloadLogs: false,
  webWorkers: false,
  streamSamples: false,
};
afterEach(() => {
  vi.useRealTimers();
});

describe("legacy webview selection", () => {
  it("retains the highlighted row but discards obsolete navigation and loading snapshots", () => {
    vi.useFakeTimers();
    const initial = testStoreState();
    const legacy = {
      version: 4,
      state: {
        app: initial.app,
        logs: { ...initial.logs, selectedLogFile: "file:///logs/old.eval" },
        log: {
          ...initial.log,
          selectedSampleHandle: {
            logFile: "file:///logs/old.eval",
            id: "one",
            epoch: 2,
          },
          loadedLog: "file:///logs/old.eval",
        },
      },
    };
    const setItem = vi.fn();
    initializeStore(capabilities, {
      getItem: () => legacy,
      setItem,
      removeItem: vi.fn(),
    });
    const state = storeImplementation?.getState();
    expect(state?.log.highlightedSample).toEqual({
      logFile: "file:///logs/old.eval",
      id: "one",
      epoch: 2,
    });
    expect(state?.logs).not.toHaveProperty("selectedLogFile");
    expect(state?.log).not.toHaveProperty("selectedSampleHandle");
    expect(state?.log).not.toHaveProperty("loadedLog");
    vi.runAllTimers();
    expect(setItem.mock.lastCall?.[0]).toBe("app-storage");
    expect(setItem.mock.lastCall?.[1]).toMatchObject({
      state: { log: state?.log, logs: state?.logs },
    });
  });

  it.each([
    null,
    "bad",
    { id: "one" },
    { id: "one", epoch: "2", logFile: "run.eval" },
  ])("discards malformed legacy selection %j", (selectedSampleHandle) => {
    vi.useFakeTimers();
    const initial = testStoreState();
    initializeStore(capabilities, {
      getItem: () => ({
        version: 4,
        state: {
          app: initial.app,
          logs: initial.logs,
          log: { ...initial.log, selectedSampleHandle },
        },
      }),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
    expect(
      storeImplementation?.getState().log.highlightedSample
    ).toBeUndefined();
    expect(storeImplementation?.getState().log).not.toHaveProperty(
      "selectedSampleHandle"
    );
    vi.runAllTimers();
  });
});
