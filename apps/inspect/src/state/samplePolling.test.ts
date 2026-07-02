/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment --
   Mock sample/event fixtures are intentionally minimal `any` stubs, and the
   assertions reach into their dynamically-shaped fields. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StoreApi, UseBoundStore } from "zustand";

import { EvalSample } from "@tsmono/inspect-common/types";

import { initAppConfig } from "../app_config";
import {
  ClientAPI,
  SampleDataResponse,
  SampleSummary,
} from "../client/api/types";
import { mergeDetails } from "../log_data";

import { pendingSamplesKey } from "./pendingSamples";
import { queryClient } from "./queryClient";
import {
  createSamplePolling,
  hasSampleDataUpdates,
  shouldFinalizeStreamingSample,
} from "./samplePolling";
import { StoreState } from "./store";

// The opened log's summaries live in the react-query details cache, keyed by
// the log dir + selected log file; tests seed both the dir (so getLogDir
// resolves) and the details, then point state at the same key.
const SELECTED_DIR = "/logs";
const SELECTED_LOG = "selected.eval";
const seedSelectedLog = () => {
  initAppConfig({
    api,
    singleFileMode: false,
    loader: "replicator",
    inspect_version: "",
    scout_version: null,
    logDir: SELECTED_DIR,
  });
  mergeDetails(SELECTED_DIR, {
    [SELECTED_LOG]: { sampleSummaries: [] } as unknown as never,
  });
};

// Pending summaries live in the pending-samples query cache (fed by the
// usePendingSamples poll in the app); tests seed the entry directly.
const seedPendingSamples = (samples: unknown[]) => {
  queryClient.setQueryData(pendingSamplesKey(SELECTED_DIR, SELECTED_LOG), {
    samples,
    refresh: 2,
  });
};

const mockApi = {
  get_log_sample: vi.fn(),
  get_log_sample_data: vi.fn(),
  log_message: vi.fn(),
};
const api = mockApi as unknown as ClientAPI;

beforeEach(() => {
  mockApi.get_log_sample.mockReset();
  mockApi.get_log_sample_data.mockReset();
  mockApi.log_message.mockReset();
});

describe("samplePolling helpers", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const emptySampleData = {
    events: [],
    attachments: [],
    message_pool: [],
    call_pool: [],
  };

  it("treats empty sample-data payloads as no-op updates", () => {
    expect(hasSampleDataUpdates(emptySampleData)).toBe(false);
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

  it.each([
    ["missing response", undefined, true, false],
    ["not found response", { status: "NotFound" }, true, false],
    ["not modified incomplete log", { status: "NotModified" }, false, false],
    ["not modified completed log", { status: "NotModified" }, true, true],
    [
      "complete response with empty data",
      {
        status: "OK",
        complete: true,
        has_more: false,
        sampleData: emptySampleData,
      },
      false,
      true,
    ],
    [
      "complete response with more chunks",
      {
        status: "OK",
        complete: true,
        has_more: true,
        sampleData: emptySampleData,
      },
      false,
      false,
    ],
    [
      "complete response with data updates",
      {
        status: "OK",
        complete: true,
        has_more: false,
        sampleData: {
          ...emptySampleData,
          events: [
            {
              id: 1,
              event_id: "event-1",
              sample_id: "sample-1",
              epoch: 1,
              // Minimal event stub; the precise Event union shape is
              // irrelevant to what this test exercises.
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              event: {} as any,
            },
          ],
        },
      },
      false,
      false,
    ],
  ] satisfies Array<
    [string, SampleDataResponse | undefined, boolean | undefined, boolean]
  >)("returns %s = %s", (_name, response, completedInLog, expected) => {
    expect(shouldFinalizeStreamingSample(response, completedInLog)).toBe(
      expected
    );
  });
});

describe("createSamplePolling", () => {
  beforeEach(() => {
    seedSelectedLog();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    queryClient.clear();
  });

  it("keeps polling until a buffer-complete sample is flushed to the eval", async () => {
    vi.useFakeTimers();

    const completedSample = createEvalSample("sample-1");
    const completePendingResponse = {
      status: "OK",
      complete: true,
      has_more: false,
      sampleData: {
        events: [],
        attachments: [],
        message_pool: [],
        call_pool: [],
      },
    } satisfies SampleDataResponse;
    mockApi.get_log_sample_data.mockResolvedValue(completePendingResponse);
    mockApi.get_log_sample
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(completedSample);

    const sampleActions = {
      setSelectedSample: vi.fn(),
      setSampleStatus: vi.fn(),
      setSampleError: vi.fn(),
      setRunningEvents: vi.fn(),
    };

    const state = {
      sample: { runningEvents: [] },
      sampleActions,
      log: {},
      logs: { selectedLogFile: SELECTED_LOG },
    } as unknown as StoreState;
    const store = {
      getState: () => state,
    } as unknown as UseBoundStore<StoreApi<StoreState>>;

    const polling = createSamplePolling(store, api);
    polling.startPolling("log.eval", createSummary("sample-1"));
    await flushPromises();

    expect(mockApi.get_log_sample).toHaveBeenCalledTimes(1);
    expect(mockApi.get_log_sample).toHaveBeenCalledWith(
      "log.eval",
      "sample-1",
      1
    );
    expect(sampleActions.setSelectedSample).not.toHaveBeenCalled();
    expect(sampleActions.setSampleStatus).toHaveBeenCalledWith("streaming");
    expect(sampleActions.setSampleStatus).not.toHaveBeenCalledWith("error");
    expect(sampleActions.setSampleError).not.toHaveBeenCalled();
    expect(sampleActions.setRunningEvents).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1999);
    expect(mockApi.get_log_sample_data).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() =>
      expect(mockApi.get_log_sample).toHaveBeenCalledTimes(2)
    );

    expect(mockApi.get_log_sample_data).toHaveBeenCalledTimes(2);
    expect(sampleActions.setSelectedSample).toHaveBeenCalledTimes(1);
    expect(sampleActions.setSampleStatus).toHaveBeenCalledWith("ok");
    expect(sampleActions.setRunningEvents).toHaveBeenCalledWith([]);

    await vi.advanceTimersByTimeAsync(2000);
    expect(mockApi.get_log_sample_data).toHaveBeenCalledTimes(2);
  });

  it("keeps polling after a transient buffer-complete sample load error", async () => {
    vi.useFakeTimers();

    const completedSample = createEvalSample("sample-1");
    mockApi.get_log_sample_data.mockResolvedValue({
      status: "OK",
      complete: true,
      has_more: false,
      sampleData: {
        events: [],
        attachments: [],
        message_pool: [],
        call_pool: [],
      },
    } satisfies SampleDataResponse);
    mockApi.get_log_sample
      .mockRejectedValueOnce(new Error("temporary read failure"))
      .mockResolvedValueOnce(completedSample);

    const sampleActions = {
      setSelectedSample: vi.fn(),
      setSampleStatus: vi.fn(),
      setSampleError: vi.fn(),
      setRunningEvents: vi.fn(),
    };

    const state = {
      sample: { runningEvents: [] },
      sampleActions,
      log: {},
      logs: { selectedLogFile: SELECTED_LOG },
    } as unknown as StoreState;
    const store = {
      getState: () => state,
    } as unknown as UseBoundStore<StoreApi<StoreState>>;

    const polling = createSamplePolling(store, api);
    polling.startPolling("log.eval", createSummary("sample-1"));
    await flushPromises();

    expect(mockApi.get_log_sample).toHaveBeenCalledTimes(1);
    expect(sampleActions.setSampleStatus).toHaveBeenCalledWith("streaming");
    expect(sampleActions.setSampleStatus).not.toHaveBeenCalledWith("error");
    expect(sampleActions.setSampleError).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2000);
    await vi.waitFor(() =>
      expect(mockApi.get_log_sample).toHaveBeenCalledTimes(2)
    );

    expect(sampleActions.setSelectedSample).toHaveBeenCalledTimes(1);
    expect(sampleActions.setSampleStatus).toHaveBeenCalledWith("ok");
    expect(sampleActions.setSampleError).not.toHaveBeenCalled();
  });

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

    mockApi.get_log_sample_data.mockResolvedValue({
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
              // Hand-built model event; not worth reconstructing the full
              // generated Event type for a fixture.
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      sample: {
        runningEvents: [],
      },
      sampleActions,
      log: {},
      logs: { selectedLogFile: SELECTED_LOG },
    } as unknown as StoreState;

    const store = {
      getState: () => state,
    } as unknown as UseBoundStore<StoreApi<StoreState>>;

    const polling = createSamplePolling(store, api);
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
    mockApi.get_log_sample_data
      .mockResolvedValueOnce({
        status: "NotFound",
      } satisfies SampleDataResponse)
      .mockImplementation(() => new Promise(() => {}));
    mockApi.get_log_sample.mockReturnValue(staleSampleDeferred.promise);

    const sampleActions = {
      setSelectedSample: vi.fn(),
      setSampleStatus: vi.fn(),
      setSampleError: vi.fn(),
      setRunningEvents: vi.fn(),
    };

    const state = {
      sample: {
        runningEvents: [],
      },
      sampleActions,
      log: {},
      logs: { selectedLogFile: SELECTED_LOG },
    } as unknown as StoreState;

    const store = {
      getState: () => state,
    } as unknown as UseBoundStore<StoreApi<StoreState>>;

    const polling = createSamplePolling(store, api);

    polling.startPolling("log.json", createSummary("sample-1"));
    await flushPromises();

    expect(mockApi.get_log_sample).toHaveBeenCalledWith(
      "log.json",
      "sample-1",
      1
    );

    polling.startPolling("log.json", createSummary("sample-2"));

    staleSampleDeferred.resolve(createEvalSample("sample-1"));
    await flushPromises();

    expect(sampleActions.setSelectedSample).not.toHaveBeenCalled();
    expect(sampleActions.setSampleStatus).not.toHaveBeenCalledWith("ok");
  });

  it("surfaces an error when the body is missing and the summary has no error", async () => {
    mockApi.get_log_sample_data.mockResolvedValueOnce({
      status: "NotFound",
    } satisfies SampleDataResponse);
    mockApi.get_log_sample.mockResolvedValue(undefined);

    const sampleActions = {
      setSelectedSample: vi.fn(),
      setSampleStatus: vi.fn(),
      setSampleError: vi.fn(),
      setRunningEvents: vi.fn(),
    };

    const state = {
      sample: { runningEvents: [] },
      sampleActions,
      log: {},
      logs: { selectedLogFile: SELECTED_LOG },
    } as unknown as StoreState;
    const store = {
      getState: () => state,
    } as unknown as UseBoundStore<StoreApi<StoreState>>;

    const polling = createSamplePolling(store, api);
    polling.startPolling("log.eval", createSummary("plain-sample"));
    await flushPromises();

    expect(sampleActions.setSelectedSample).not.toHaveBeenCalled();
    expect(sampleActions.setSampleStatus).toHaveBeenCalledWith("error");
    expect(sampleActions.setSampleError).toHaveBeenCalled();
  });

  it("uses the live store summary for the synthesis check, not the stub passed to startPolling", async () => {
    mockApi.get_log_sample_data.mockResolvedValueOnce({
      status: "NotFound",
    } satisfies SampleDataResponse);
    mockApi.get_log_sample.mockResolvedValue(undefined);

    const sampleActions = {
      setSelectedSample: vi.fn(),
      setSampleStatus: vi.fn(),
      setSampleError: vi.fn(),
      setRunningEvents: vi.fn(),
    };

    // Live pending samples (query cache) include the same sample with `error`.
    seedPendingSamples([
      {
        id: "rocket-medium-vision",
        epoch: 1,
        error: "RuntimeError: server.py exited before becoming ready",
        completed: true,
      },
    ]);
    const state = {
      sample: { runningEvents: [] },
      sampleActions,
      logs: { selectedLogFile: SELECTED_LOG },
      log: {},
    } as unknown as StoreState;
    const store = {
      getState: () => state,
    } as unknown as UseBoundStore<StoreApi<StoreState>>;

    const polling = createSamplePolling(store, api);
    // Simulate the stub summary that usePollSampleSideEffect actually passes today.
    polling.startPolling("log.eval", {
      id: "rocket-medium-vision",
      epoch: 1,
    } as SampleSummary);
    await flushPromises();

    expect(mockApi.get_log_sample).toHaveBeenCalled();
    expect(sampleActions.setSelectedSample).toHaveBeenCalledTimes(1);
    const firstCall = sampleActions.setSelectedSample.mock.calls[0];
    if (firstCall === undefined) throw new Error("expected a call");
    const [synthesizedSample] = firstCall;
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

    mockApi.get_log_sample_data.mockResolvedValueOnce({
      status: "NotFound",
    } satisfies SampleDataResponse);
    mockApi.get_log_sample.mockResolvedValue(realSample);

    const sampleActions = {
      setSelectedSample: vi.fn(),
      setSampleStatus: vi.fn(),
      setSampleError: vi.fn(),
      setRunningEvents: vi.fn(),
    };

    seedPendingSamples([
      {
        id: "dig-medium-vision",
        epoch: 1,
        error: "summary error string (would be used by synthesizer)",
        completed: true,
      },
    ]);
    const state = {
      sample: { runningEvents: [] },
      sampleActions,
      logs: { selectedLogFile: SELECTED_LOG },
      log: {},
    } as unknown as StoreState;
    const store = {
      getState: () => state,
    } as unknown as UseBoundStore<StoreApi<StoreState>>;

    const polling = createSamplePolling(store, api);
    polling.startPolling("log.eval", {
      id: "dig-medium-vision",
      epoch: 1,
    } as SampleSummary);
    await flushPromises();

    expect(sampleActions.setSelectedSample).toHaveBeenCalledTimes(1);
    const firstCall = sampleActions.setSelectedSample.mock.calls[0];
    if (firstCall === undefined) throw new Error("expected a call");
    const [passedSample] = firstCall;
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
  }) as unknown as SampleSummary;

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
