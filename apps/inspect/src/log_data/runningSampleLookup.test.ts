import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { testEvalSample } from "@tsmono/inspect-common/testing";
import { EvalSample } from "@tsmono/inspect-common/types";

import { initAppConfig } from "../app_config";
import { SampleHandle } from "../app/types";
import { SampleSummary } from "../client/api/types";
import { deriveSampleFields } from "../client/utils/derive";
import { queryClient } from "../state/queryClient";

import { setListing } from "./logsContent";
import { streamRunningSampleTick } from "./runningSampleQuery";
import { sampleQueryKey } from "./sampleQuery";
import { samplesListingKey, SamplesListingRow } from "./samplesListing";
import { testClientAPI, testSampleSummary } from "./testFixtures";

const LOG_DIR = "/logs";

const mockApi = {
  get_log_sample: vi.fn(),
  get_log_sample_data: vi.fn(),
  log_message: vi.fn(),
};
const api = testClientAPI(mockApi);

const handle: SampleHandle = {
  id: "sample-1",
  epoch: 1,
  logFile: "late.eval",
};

const seedSummary = (logFile: string, summary: SampleSummary) => {
  queryClient.setQueryData<SamplesListingRow[]>(
    samplesListingKey({ logDir: LOG_DIR, scope: { file: logFile } }),
    [
      {
        logFile,
        summary,
        derived: deriveSampleFields(summary),
        log: {},
      },
    ]
  );
};

beforeEach(() => {
  mockApi.get_log_sample.mockReset();
  mockApi.get_log_sample_data.mockReset();
  mockApi.log_message.mockReset();
  initAppConfig({
    api,
    singleFileMode: false,
    loader: "replicator",
    inspect_version: "",
    scout_version: null,
    logDir: LOG_DIR,
  });
});

afterEach(() => {
  queryClient.clear();
});

describe("running sample summary lookup", () => {
  it("resolves a listed log that appears after streaming starts", async () => {
    mockApi.get_log_sample_data.mockResolvedValue({ status: "NotModified" });

    const first = await streamRunningSampleTick(api, LOG_DIR, handle);
    expect(first.finalized).toBe(false);

    setListing(LOG_DIR, [{ name: "/logs/late.eval" }]);
    seedSummary(
      "/logs/late.eval",
      testSampleSummary({ id: "sample-1", epoch: 1, completed: true })
    );
    mockApi.get_log_sample.mockResolvedValueOnce(
      testEvalSample({ id: "sample-1", epoch: 1 })
    );

    const second = await streamRunningSampleTick(api, LOG_DIR, handle);
    expect(second.finalized).toBe(true);
    expect(
      queryClient.getQueryData<EvalSample>(sampleQueryKey(handle))
    ).toBeDefined();
  });
});
