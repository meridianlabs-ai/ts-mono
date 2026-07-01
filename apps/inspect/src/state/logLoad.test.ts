import { beforeEach, describe, expect, test, vi } from "vitest";

import { initAppConfig } from "../app/appConfig";
import { ClientAPI, LogDetails } from "../client/api/types";
import { DatabaseService } from "../client/database";

import { initDatabaseService } from "./databaseServiceInstance";
import { loadLog } from "./logLoad";
import * as logsContent from "./logsContent";
import { queryClient } from "./queryClient";
import { StoreState } from "./store";

const startPolling = vi.fn();

vi.mock("./logPollingInstance", () => ({
  getLogPolling: () => ({ startPolling }),
}));

// loadLog reaches the store singleton for its UI-state action setters and the
// current selection; back it with a controllable fake.
let storeState: StoreState;
vi.mock("./store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./store")>();
  return {
    ...actual,
    get storeImplementation() {
      return { getState: () => storeState };
    },
  };
});

const logDetails = (status: LogDetails["status"]): LogDetails =>
  ({
    status,
    eval: { task: "task", model: "model" },
    sampleSummaries: [],
  }) as unknown as LogDetails;

const createHarness = (
  cachedInfo: LogDetails | null,
  freshInfo: LogDetails
) => {
  const mergePreviews = vi
    .spyOn(logsContent, "mergePreviews")
    .mockImplementation(() => {});
  const mergeDetails = vi
    .spyOn(logsContent, "mergeDetails")
    .mockImplementation(() => {});
  const writeDetail = vi
    .spyOn(logsContent, "writeDetail")
    .mockResolvedValue(undefined);

  const databaseService = {
    opened: vi.fn(() => true),
    readLogDetailsForFile: vi.fn().mockResolvedValue(cachedInfo),
    writeLogDetail: vi.fn().mockResolvedValue(undefined),
  };
  initDatabaseService(databaseService as unknown as DatabaseService);

  const api = {
    get_log_details: vi.fn().mockResolvedValue(freshInfo),
  };

  initAppConfig({
    api: api as unknown as ClientAPI,
    singleFileMode: false,
    loader: "replicator",
    inspect_version: "",
    scout_version: null,
    logDir: "/logs",
  });

  const onLogDetailsLoaded = vi.fn();
  const clearPendingSampleSummaries = vi.fn();
  const setLoadedLog = vi.fn();

  storeState = {
    logs: { selectedLogFile: "/logs/run.eval" },
    logActions: {
      onLogDetailsLoaded,
      clearPendingSampleSummaries,
      setLoadedLog,
    },
  } as unknown as StoreState;

  return {
    api,
    databaseService,
    onLogDetailsLoaded,
    clearPendingSampleSummaries,
    setLoadedLog,
    mergePreviews,
    mergeDetails,
    writeDetail,
  };
};

describe("loadLog", () => {
  beforeEach(() => {
    startPolling.mockClear();
  });

  test("treats cached started details as provisional and refreshes before repainting the listing", async () => {
    const harness = createHarness(logDetails("started"), logDetails("success"));

    await loadLog("run.eval");

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
    expect(harness.setLoadedLog).toHaveBeenCalledWith("run.eval");
    expect(startPolling).toHaveBeenCalledWith("run.eval");

    harness.mergePreviews.mockRestore();
    harness.mergeDetails.mockRestore();
    harness.writeDetail.mockRestore();
    queryClient.clear();
  });

  test("seeds cache from a completed cached row and refreshes in the background", async () => {
    const harness = createHarness(logDetails("success"), logDetails("success"));

    await loadLog("run.eval");

    // Completed cached row is seeded straight into the details cache.
    expect(harness.mergeDetails).toHaveBeenCalled();
    expect(harness.onLogDetailsLoaded).toHaveBeenCalled();
    expect(harness.setLoadedLog).toHaveBeenCalledWith("run.eval");
    expect(startPolling).toHaveBeenCalledWith("run.eval");

    harness.mergePreviews.mockRestore();
    harness.mergeDetails.mockRestore();
    harness.writeDetail.mockRestore();
    queryClient.clear();
  });

  test("falls through to a fresh fetch when nothing is cached", async () => {
    const harness = createHarness(null, logDetails("success"));

    await loadLog("run.eval");

    expect(harness.databaseService.readLogDetailsForFile).toHaveBeenCalledWith(
      "/logs/run.eval"
    );
    expect(harness.api.get_log_details).toHaveBeenCalledWith("run.eval", false);
    expect(harness.onLogDetailsLoaded).toHaveBeenCalled();
    expect(harness.setLoadedLog).toHaveBeenCalledWith("run.eval");
    expect(harness.clearPendingSampleSummaries).toHaveBeenCalled();
    expect(startPolling).toHaveBeenCalledWith("run.eval");

    harness.mergePreviews.mockRestore();
    harness.mergeDetails.mockRestore();
    harness.writeDetail.mockRestore();
    queryClient.clear();
  });
});
