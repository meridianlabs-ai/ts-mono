import { describe, expect, test, vi } from "vitest";

import { ClientAPI, LogDetails, LogPreview } from "../client/api/types";

import { createLogSlice } from "./logSlice";
import { StoreState } from "./store";

const logDetails = (status: LogDetails["status"]): LogDetails =>
  ({
    status,
    eval: {
      task: "task",
      model: "model",
    },
    sampleSummaries: [],
  }) as unknown as LogDetails;

const createHarness = (cachedInfo: LogDetails, freshInfo: LogDetails) => {
  const state = {} as StoreState;

  const set = vi.fn((fn: (state: StoreState) => void) => {
    fn(state);
  });
  const get = () => state;

  // Log content lives in the react-query cache now; the slice calls this
  // action shim, so the mock just records the call for assertions.
  const updateLogPreviews = vi.fn(
    (_previews: Record<string, LogPreview>) => {}
  );

  const databaseService = {
    opened: vi.fn(() => true),
    readLogDetailsForFile: vi.fn().mockResolvedValue(cachedInfo),
    writeLogDetail: vi.fn().mockResolvedValue(undefined),
  };

  const api = {
    get_log_details: vi.fn().mockResolvedValue(freshInfo),
  } as unknown as ClientAPI;

  Object.assign(state, {
    appActions: {
      setWorkspaceTab: vi.fn(),
    },
    databaseService,
    logs: {
      logDir: "/logs",
      selectedLogFile: "/logs/run.eval",
    },
    logsActions: {
      initLogDir: vi.fn().mockResolvedValue("/logs"),
      updateLogPreviews,
    },
  } as unknown as StoreState);

  const [slice, cleanup] = createLogSlice(set, get, {}, api);
  state.log = { ...slice.log };
  state.logActions = slice.logActions;

  return {
    api,
    cleanup,
    databaseService,
    state,
    updateLogPreviews,
  };
};

describe("logSlice.syncLog", () => {
  test("treats cached started details as provisional and refreshes before repainting the listing", async () => {
    const harness = createHarness(logDetails("started"), logDetails("success"));

    await harness.state.logActions.syncLog("run.eval");

    expect(harness.databaseService.readLogDetailsForFile).toHaveBeenCalledWith(
      "/logs/run.eval"
    );
    expect(harness.api.get_log_details).toHaveBeenCalledWith(
      "/logs/run.eval",
      false
    );
    expect(harness.updateLogPreviews).toHaveBeenCalledTimes(1);
    expect(
      harness.updateLogPreviews.mock.calls[0]?.[0]["run.eval"]?.status
    ).toBe("success");
    expect(harness.state.log.selectedLogDetails?.status).toBe("success");

    harness.cleanup();
  });
});
