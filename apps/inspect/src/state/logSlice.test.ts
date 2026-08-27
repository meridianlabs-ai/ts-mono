import { describe, expect, test, vi } from "vitest";

import { createLogSlice } from "./logSlice";
import { StoreState } from "./store";

const createHarness = () => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, @typescript-eslint/consistent-type-assertions -- deliberately empty: the slice under test writes into this object, and reads only what it wrote
  const state = {} as StoreState;
  const set = vi.fn((fn: (state: StoreState) => void) => {
    fn(state);
  });
  const get = () => state;

  const slice = createLogSlice(set, get, {});
  state.log = { ...slice.log };
  state.logActions = slice.logActions;

  return { state };
};

describe("logSlice.setLoadedLog", () => {
  test("records the loaded log as UI state", () => {
    const harness = createHarness();

    harness.state.logActions.setLoadedLog("run.eval");

    expect(harness.state.log.loadedLog).toBe("run.eval");
  });
});
