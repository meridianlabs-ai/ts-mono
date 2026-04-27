import { describe, expect, it, vi } from "vitest";
import { StoreApi, UseBoundStore } from "zustand";

import { EvalSample } from "@tsmono/inspect-common/types";

import { SampleDataResponse } from "../../client/api/types";
import {
  createSamplePolling,
  hasSampleDataUpdates,
  shouldFinalizeStreamingSample,
} from "../../state/samplePolling";
import { StoreState } from "../../state/store";

describe("samplePolling helpers", () => {
  it("treats empty sample-data payloads as no-op updates", () => {
    expect(
      hasSampleDataUpdates({
        events: [],
        attachments: [],
        message_pool: [],
        call_pool: [],
      })
    ).toBe(false);
  });

  it("detects sample-data deltas across all streamed collections", () => {
    expect(
      hasSampleDataUpdates({
        events: [],
        attachments: [
          {
            id: 1,
            sample_id: "sample-1",
            epoch: 1,
            hash: "hash-1",
            content: "content",
          },
        ],
        message_pool: [],
        call_pool: [],
      })
    ).toBe(true);
  });

  it("finalizes streaming when the sample is complete in the log and only empty deltas remain", () => {
    const response: SampleDataResponse = {
      status: "OK",
      sampleData: {
        events: [],
        attachments: [],
        message_pool: [],
        call_pool: [],
      },
    };

    expect(shouldFinalizeStreamingSample(response, true)).toBe(true);
  });

  it("keeps streaming when the sample is still incomplete in the log", () => {
    const response: SampleDataResponse = {
      status: "OK",
      sampleData: {
        events: [],
        attachments: [],
        message_pool: [],
        call_pool: [],
      },
    };

    expect(shouldFinalizeStreamingSample(response, false)).toBe(false);
  });
});

describe("createSamplePolling", () => {
  it("aborts a stale completion fetch when a new polling session starts", async () => {
    const staleSampleDeferred = deferred<EvalSample | undefined>();
    const getLogSampleData = vi
      .fn()
      .mockResolvedValueOnce({
        status: "NotFound",
      } satisfies SampleDataResponse)
      .mockImplementation(() => new Promise(() => {}));
    const getLogSample = vi.fn().mockReturnValue(staleSampleDeferred.promise);

    const sampleActions = {
      setSelectedSample: vi.fn(),
      setSampleStatus: vi.fn(),
      setSampleError: vi.fn(),
      setRunningEvents: vi.fn(),
    };

    const state = {
      api: {
        get_log_sample_data: getLogSampleData,
        get_log_sample: getLogSample,
      },
      sample: {
        runningEvents: [],
      },
      sampleActions,
      log: {
        selectedLogDetails: {
          sampleSummaries: [],
        },
      },
    } as unknown as StoreState;

    const store = {
      getState: () => state,
    } as unknown as UseBoundStore<StoreApi<StoreState>>;

    const polling = createSamplePolling(store);

    polling.startPolling("log.json", createSummary("sample-1"));
    await flushPromises();

    expect(getLogSample).toHaveBeenCalledWith("log.json", "sample-1", 1);

    polling.startPolling("log.json", createSummary("sample-2"));

    staleSampleDeferred.resolve(createEvalSample("sample-1"));
    await flushPromises();

    expect(sampleActions.setSelectedSample).not.toHaveBeenCalled();
    expect(sampleActions.setSampleStatus).not.toHaveBeenCalledWith("ok");
  });
});

const createSummary = (id: string) =>
  ({
    id,
    epoch: 1,
  }) as any;

const createEvalSample = (id: string) =>
  ({
    id,
    epoch: 1,
    events: [],
    messages: [],
    metadata: {},
    store: {},
    attachments: {},
    scores: null,
    input: null,
    target: null,
  }) as unknown as EvalSample;

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};
