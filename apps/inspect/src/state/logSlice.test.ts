import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveSamplesView } from "../app/samples/list/samplesView.converters";

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

describe("persisted state from an older build", () => {
  it("fills keys added since the blob was written", () => {
    vi.useFakeTimers();
    const initial = testStoreState();
    const app = structuredClone(initial.app);
    Reflect.deleteProperty(app.tabs, "sample");
    const logFile = "file:///logs/old.eval";
    initializeStore(capabilities, {
      getItem: () => ({
        version: 4,
        state: {
          app,
          log: initial.log,
          logs: {
            ...initial.logs,
            samplesListState: {
              ...initial.logs.samplesListState,
              byLog: {
                [logFile]: {
                  name: "Default",
                  columns: [{ id: "sampleId", visible: true }],
                  sort: [],
                  filters: { dsl: "", extraColumnFilters: {} },
                  multiline: false,
                  compactScores: false,
                  colorScalesEnabled: true,
                },
              },
            },
          },
        },
      }),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });

    const state = storeImplementation?.getState();
    expect(state?.app.tabs.sample).toBe(initial.app.tabs.sample);
    const view = state?.logs.samplesListState.byLog[logFile];
    expect(view?.multiline).toBe(false);
    expect(view?.columns).toEqual([{ id: "sampleId", visible: true }]);
    // A view stored before userOverrides existed inherits every toggle.
    const resolved = resolveSamplesView(view, {
      name: "Eval",
      multiline: true,
      compact_scores: true,
      color_scales_enabled: false,
    });
    expect(resolved.multiline).toBe(true);
    expect(resolved.compactScores).toBe(true);
    expect(resolved.colorScalesEnabled).toBe(false);
    vi.runAllTimers();
  });

  it("starts from the initial slices when a blob holds null slices", () => {
    vi.useFakeTimers();
    initializeStore(capabilities, {
      getItem: () => ({
        version: 4,
        state: { app: null, log: null, logs: null },
      }),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });

    const state = storeImplementation?.getState();
    expect(state?.app.tabs.sample).toBe(testStoreState().app.tabs.sample);
    expect(state?.logs.samplesListState.byLog).toEqual({});
    expect(state?.log.highlightedSample).toBeUndefined();
    vi.runAllTimers();
  });
});
