import { describe, expect, test, vi } from "vitest";

import { ClientAPI } from "../client/api/types";

import { createLogSlice } from "./logSlice";
import { StoreState } from "./store";

vi.mock("./logPollingInstance", () => ({
  getLogPolling: () => ({ startPolling: vi.fn() }),
  cleanupLogPolling: vi.fn(),
}));

const createHarness = () => {
  const state = {} as StoreState;
  const set = vi.fn((fn: (state: StoreState) => void) => {
    fn(state);
  });
  const get = () => state;
  const api = {} as unknown as ClientAPI;

  const [slice, cleanup] = createLogSlice(set, get, {}, api);
  state.log = { ...slice.log };
  state.logActions = slice.logActions;

  return { state, cleanup };
};

describe("logSlice.setLoadedLog", () => {
  test("records the loaded log as UI state", () => {
    const harness = createHarness();

    harness.state.logActions.setLoadedLog("run.eval");

    expect(harness.state.log.loadedLog).toBe("run.eval");
    harness.cleanup();
  });
});
