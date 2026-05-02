import { describe, expect, it, vi } from "vitest";
import { StoreApi, UseBoundStore } from "zustand";

import { EvalSample } from "@tsmono/inspect-common/types";

import { SampleDataResponse, SampleSummary } from "../client/api/types";

import {
  createSamplePolling,
  hasSampleDataUpdates,
  shouldFinalizeStreamingSample,
} from "./samplePolling";
import { StoreState } from "./store";

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
  it("does not let duplicate streamed pool rows shift refs", async () => {
    const inputSystem = chatMessage("input-system", "system", "Input system");
    const inputUser = chatMessage("input-user", "user", "Input user");
    const inputAssistant = chatMessage(
      "input-assistant",
      "assistant",
      "Input assistant"
    );
    const system = { role: "system", content: "System" };
    const user = { role: "user", content: "User" };
    const assistant = { role: "assistant", content: "Assistant" };

    const getLogSampleData = vi.fn().mockResolvedValue({
      status: "OK",
      sampleData: {
        attachments: [],
        message_pool: [
          messagePoolEntry(1, inputSystem),
          messagePoolEntry(2, inputUser),
          messagePoolEntry(1, inputSystem),
          messagePoolEntry(2, inputUser),
          messagePoolEntry(3, inputAssistant),
        ],
        call_pool: [
          callPoolEntry(1, system),
          callPoolEntry(2, user),
          callPoolEntry(1, system),
          callPoolEntry(2, user),
          callPoolEntry(3, assistant),
        ],
        events: [
          {
            id: 1,
            event_id: "model-event-1",
            sample_id: "sample-1",
            epoch: 1,
            event: {
              event: "model",
              input: [],
              input_refs: [[0, 3]],
              model: "test",
              tools: [],
              tool_choice: "auto",
              config: {},
              output: { model: "test", choices: [] },
              call: {
                request: { model: "test" },
                response: null,
                call_refs: [[0, 3]],
                call_key: "messages",
              },
            } as any,
          },
        ],
      },
    } satisfies SampleDataResponse);

    const sampleActions = {
      setSelectedSample: vi.fn(),
      setSampleStatus: vi.fn(),
      setSampleError: vi.fn(),
      setRunningEvents: vi.fn(),
    };

    const state = {
      api: {
        get_log_sample_data: getLogSampleData,
        get_log_sample: vi.fn(),
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
    polling.stopPolling();

    const runningEvents = sampleActions.setRunningEvents.mock.calls.at(-1)?.[0];
    expect(runningEvents[0].input).toEqual([
      inputSystem,
      inputUser,
      inputAssistant,
    ]);
    expect(runningEvents[0].call.request.messages).toEqual([
      system,
      user,
      assistant,
    ]);
  });

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

  it("surfaces an error when the body is missing and the summary has no error", async () => {
    const getLogSampleData = vi.fn().mockResolvedValueOnce({
      status: "NotFound",
    } satisfies SampleDataResponse);
    const getLogSample = vi.fn().mockResolvedValue(undefined);

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
      sample: { runningEvents: [] },
      sampleActions,
      log: { selectedLogDetails: { sampleSummaries: [] } },
    } as unknown as StoreState;
    const store = {
      getState: () => state,
    } as unknown as UseBoundStore<StoreApi<StoreState>>;

    const polling = createSamplePolling(store);
    polling.startPolling("log.eval", createSummary("plain-sample"));
    await flushPromises();

    expect(sampleActions.setSelectedSample).not.toHaveBeenCalled();
    expect(sampleActions.setSampleStatus).toHaveBeenCalledWith("error");
    expect(sampleActions.setSampleError).toHaveBeenCalled();
  });

  it("uses the live store summary for the synthesis check, not the stub passed to startPolling", async () => {
    const getLogSampleData = vi.fn().mockResolvedValueOnce({
      status: "NotFound",
    } satisfies SampleDataResponse);
    const getLogSample = vi.fn().mockResolvedValue(undefined);

    const sampleActions = {
      setSelectedSample: vi.fn(),
      setSampleStatus: vi.fn(),
      setSampleError: vi.fn(),
      setRunningEvents: vi.fn(),
    };

    // Live store state: pending samples include the same sample with `error`.
    const state = {
      api: {
        get_log_sample_data: getLogSampleData,
        get_log_sample: getLogSample,
      },
      sample: { runningEvents: [] },
      sampleActions,
      log: {
        selectedLogDetails: { sampleSummaries: [] },
        pendingSampleSummaries: {
          samples: [
            {
              id: "rocket-medium-vision",
              epoch: 1,
              error: "RuntimeError: server.py exited before becoming ready",
              completed: true,
            },
          ],
        },
      },
    } as unknown as StoreState;
    const store = {
      getState: () => state,
    } as unknown as UseBoundStore<StoreApi<StoreState>>;

    const polling = createSamplePolling(store);
    // Simulate the stub summary that usePollSample actually passes today.
    polling.startPolling("log.eval", {
      id: "rocket-medium-vision",
      epoch: 1,
    } as SampleSummary);
    await flushPromises();

    expect(getLogSample).toHaveBeenCalled();
    expect(sampleActions.setSelectedSample).toHaveBeenCalledTimes(1);
    const [synthesizedSample] = sampleActions.setSelectedSample.mock.calls[0];
    expect(synthesizedSample.error?.message).toBe(
      "RuntimeError: server.py exited before becoming ready"
    );
    expect(sampleActions.setSampleStatus).toHaveBeenCalledWith("ok");
    expect(sampleActions.setSampleError).not.toHaveBeenCalled();
  });

  it("uses the fetched body when present, even if the summary carries an error", async () => {
    // Errored-but-flushed scenario: the body IS in the .eval zip with rich
    // events; the summary still reports the error. The fetched body must
    // win — synthesizing from the summary would lose the rich data.
    const realSample = {
      ...createEvalSample("dig-medium-vision"),
      error: {
        message: "real sample error from .eval body",
        traceback: "real-traceback",
        traceback_ansi: "real-traceback",
      },
    };

    const getLogSampleData = vi.fn().mockResolvedValueOnce({
      status: "NotFound",
    } satisfies SampleDataResponse);
    const getLogSample = vi.fn().mockResolvedValue(realSample);

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
      sample: { runningEvents: [] },
      sampleActions,
      log: {
        selectedLogDetails: { sampleSummaries: [] },
        pendingSampleSummaries: {
          samples: [
            {
              id: "dig-medium-vision",
              epoch: 1,
              error: "summary error string (would be used by synthesizer)",
              completed: true,
            },
          ],
        },
      },
    } as unknown as StoreState;
    const store = {
      getState: () => state,
    } as unknown as UseBoundStore<StoreApi<StoreState>>;

    const polling = createSamplePolling(store);
    polling.startPolling("log.eval", {
      id: "dig-medium-vision",
      epoch: 1,
    } as SampleSummary);
    await flushPromises();

    expect(sampleActions.setSelectedSample).toHaveBeenCalledTimes(1);
    const [passedSample] = sampleActions.setSelectedSample.mock.calls[0];
    expect(passedSample.error?.message).toBe(
      "real sample error from .eval body"
    );
    expect(sampleActions.setSampleStatus).toHaveBeenCalledWith("ok");
  });
});

const createSummary = (id: string) =>
  ({
    id,
    epoch: 1,
  }) as any;

const chatMessage = (id: string, role: string, content: string) => ({
  id,
  role,
  content,
  source: "input",
  metadata: null,
});

const messagePoolEntry = (id: number, data: object) => ({
  id,
  sample_id: "sample-1",
  epoch: 1,
  msg_id: `msg-${id}`,
  data: JSON.stringify(data),
});

const callPoolEntry = (id: number, data: object) => ({
  id,
  sample_id: "sample-1",
  epoch: 1,
  hash: `hash-${id}`,
  data: JSON.stringify(data),
});

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
