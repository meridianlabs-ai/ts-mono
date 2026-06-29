import { describe, expect, test, vi } from "vitest";

import { seedLogDirForTest } from "../app/server/useLogDir";
import { ClientAPI, LogDetails } from "../client/api/types";
import { DatabaseService } from "../client/database";

import { initDatabaseService } from "./databaseServiceInstance";
import * as logsContent from "./logsContent";
import { createLogSlice } from "./logSlice";
import { queryClient } from "./queryClient";
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

  // Log content lives in the react-query cache; syncLog writes previews
  // directly via logsContent. Spy on the merge so we can assert against it.
  const mergePreviews = vi
    .spyOn(logsContent, "mergePreviews")
    .mockImplementation(() => {});

  // The opened-log details are written into the react-query collection via the
  // seam; spy on it so we can assert the fresh details were cached.
  const writeDetail = vi
    .spyOn(logsContent, "writeDetail")
    .mockResolvedValue(undefined);

  const databaseService = {
    opened: vi.fn(() => true),
    readLogDetailsForFile: vi.fn().mockResolvedValue(cachedInfo),
    writeLogDetail: vi.fn().mockResolvedValue(undefined),
  };

  // logSlice reads the shared DatabaseService from the module singleton rather
  // than zustand state; inject the fake via the singleton's init seam.
  initDatabaseService(databaseService as unknown as DatabaseService);

  // syncLog reads the log dir from the ["log-dir"] react-query cache (settled by
  // the loader gate in the app); seed it here.
  seedLogDirForTest("/logs");

  const api = {
    get_log_details: vi.fn().mockResolvedValue(freshInfo),
  } as unknown as ClientAPI;

  Object.assign(state, {
    appActions: {
      setWorkspaceTab: vi.fn(),
    },
    logs: {
      logDir: "/logs",
      selectedLogFile: "/logs/run.eval",
    },
    logsActions: {
      initLogDir: vi.fn().mockResolvedValue("/logs"),
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
    mergePreviews,
    writeDetail,
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
    expect(harness.mergePreviews).toHaveBeenCalledTimes(1);
    expect(harness.mergePreviews.mock.calls[0]?.[1]["run.eval"]?.status).toBe(
      "success"
    );
    expect(harness.writeDetail).toHaveBeenCalledTimes(1);
    expect(harness.writeDetail.mock.calls[0]?.[3]?.status).toBe("success");

    harness.mergePreviews.mockRestore();
    harness.writeDetail.mockRestore();
    harness.cleanup();
    queryClient.clear();
  });
});
