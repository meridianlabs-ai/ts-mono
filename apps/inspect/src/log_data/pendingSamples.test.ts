import { afterEach, describe, expect, it, vi } from "vitest";

import { testEvalSpec } from "@tsmono/inspect-common/testing";

import {
  ClientAPI,
  LogDetails,
  PendingSampleResponse,
  PendingSamples,
  SampleSummary,
} from "../client/api/types";
import { queryClient } from "../state/queryClient";

import { fetchEngine } from "./fetchEngine";
import { createLogsContentSink } from "./logsContent";
import {
  fetchPendingSamples,
  nextPendingSamples,
  pendingSamplesIntervalMs,
  pendingSamplesKey,
  shouldPollPendingSamples,
} from "./pendingSamples";
import {
  testClientAPI,
  testLogDetails,
  testSampleSummary,
} from "./testFixtures";

const sample = (id: string): SampleSummary =>
  testSampleSummary({ id, epoch: 1 });

const pending = (
  ids: string[],
  extra?: Partial<PendingSamples>
): PendingSamples => ({
  samples: ids.map(sample),
  refresh: 2,
  ...extra,
});

describe("shouldPollPendingSamples", () => {
  it.each([
    ["running log with buffer api", "log.eval", "started", true, true],
    ["no log selected", undefined, "started", true, false],
    ["log not running", "log.eval", "success", true, false],
    ["status unknown (details not loaded)", "log.eval", undefined, true, false],
    ["api without buffer", "log.eval", "started", false, false],
  ] as const)(
    "%s -> %s",
    (_name, logFile, logStatus, apiSupports, expected) => {
      expect(
        shouldPollPendingSamples({
          logFile,
          logStatus,
          apiSupportsPendingSamples: apiSupports,
        })
      ).toBe(expected);
    }
  );
});

describe("pendingSamplesIntervalMs", () => {
  it.each([
    ["no data yet", undefined, 2000],
    ["cleared data", null, 2000],
    ["server refresh hint", pending([], { refresh: 5 }), 5000],
  ] as const)("%s -> %d", (_name, data, expected) => {
    expect(pendingSamplesIntervalMs(data)).toBe(expected);
  });
});

describe("nextPendingSamples", () => {
  const prev = pending(["a"]);
  const fresh = pending(["a", "b"]);

  it.each([
    [
      "OK replaces the data",
      prev,
      { status: "OK", pendingSamples: fresh },
      fresh,
    ],
    ["OK without a payload keeps previous", prev, { status: "OK" }, prev],
    ["NotModified keeps previous", prev, { status: "NotModified" }, prev],
    ["NotModified with nothing prior", null, { status: "NotModified" }, null],
    ["NotFound clears", prev, { status: "NotFound" }, null],
  ] as const satisfies ReadonlyArray<
    readonly [
      string,
      PendingSamples | null,
      PendingSampleResponse,
      PendingSamples | null,
    ]
  >)("%s", (_name, previous, response, expected) => {
    expect(nextPendingSamples(previous, response)).toBe(expected);
  });
});

describe("fetchPendingSamples", () => {
  const LOG_DIR = "/logs";
  const LOG_FILE = "run.eval";

  const runningDetails = (): LogDetails =>
    testLogDetails({
      status: "started",
      eval: testEvalSpec({ task: "task", model: "m" }),
    });

  /**
   * An api serving `response` from the buffer, with the real fetch engine
   * started over it (as the replicator does below the gate), so details
   * re-reads are observable as `get_log_details` calls. A fresh re-read
   * bypasses the remote-file snapshot: `get_log_details(file, false)`.
   */
  const apiWith = async (
    response: PendingSampleResponse,
    info: { size: number } = { size: 100 }
  ) => {
    const getPending = vi.fn().mockResolvedValue(response);
    const getDetails = vi.fn((_file: string, _cached?: boolean) =>
      Promise.resolve(runningDetails())
    );
    let currentInfo = info;
    const api: ClientAPI = testClientAPI({
      get_log_pending_samples: getPending,
      get_log_info: vi.fn(() => Promise.resolve(currentInfo)),
      get_log_details: getDetails,
    });
    await fetchEngine.start({
      api,
      database: null,
      sink: createLogsContentSink(null, LOG_DIR),
      logDir: LOG_DIR,
    });
    return {
      api,
      getPending,
      getDetails,
      setSize: (size: number) => {
        currentInfo = { size };
      },
    };
  };

  afterEach(() => {
    fetchEngine.stop();
    queryClient.clear();
    vi.restoreAllMocks();
  });

  it("threads the cached etag and lands fresh data after a fresh details re-read", async () => {
    queryClient.setQueryData(
      pendingSamplesKey(LOG_DIR, LOG_FILE),
      pending(["a"], { etag: "etag-1" })
    );
    const fresh = pending(["a", "b"], { etag: "etag-2" });
    const { api, getPending, getDetails } = await apiWith({
      status: "OK",
      pendingSamples: fresh,
    });

    // Pass-through spy: on a running log the engine reads the network either
    // way, so `fresh` is only visible as the demand it's given.
    const ensure = vi.spyOn(fetchEngine, "ensure");

    const result = await fetchPendingSamples(api, LOG_DIR, LOG_FILE);

    expect(getPending).toHaveBeenCalledWith(LOG_FILE, "etag-1");
    expect(result).toBe(fresh);
    expect(getDetails).toHaveBeenCalledWith(LOG_FILE, false);
    expect(ensure).toHaveBeenCalledWith(LOG_FILE, {
      depth: "detailed",
      priority: "elevated",
      fresh: true,
    });
  });

  it("skips the details re-read when the file is unchanged since the last read", async () => {
    const prev = pending(["a"], { etag: "etag-1" });
    queryClient.setQueryData(pendingSamplesKey(LOG_DIR, LOG_FILE), prev);
    const { api, getDetails } = await apiWith({ status: "NotModified" });

    await fetchPendingSamples(api, LOG_DIR, LOG_FILE);
    getDetails.mockClear();
    const result = await fetchPendingSamples(api, LOG_DIR, LOG_FILE);

    expect(result).toBe(prev);
    expect(getDetails).not.toHaveBeenCalled();
  });

  it("re-reads details on a NotModified tick when the file changed", async () => {
    const { api, getDetails, setSize } = await apiWith({
      status: "NotModified",
    });

    await fetchPendingSamples(api, LOG_DIR, LOG_FILE);
    getDetails.mockClear();
    setSize(150);
    await fetchPendingSamples(api, LOG_DIR, LOG_FILE);

    expect(getDetails).toHaveBeenCalledWith(LOG_FILE, false);
  });

  it("retries the re-read on the next tick when it fails", async () => {
    const { api, getDetails } = await apiWith({ status: "NotModified" });
    // Every attempt fails, so the engine's own retries give up and the
    // tick's re-read rejects.
    getDetails.mockRejectedValue(new Error("read failed"));

    await expect(fetchPendingSamples(api, LOG_DIR, LOG_FILE)).rejects.toThrow(
      "read failed"
    );
    getDetails.mockReset();
    getDetails.mockResolvedValue(runningDetails());
    await fetchPendingSamples(api, LOG_DIR, LOG_FILE);

    expect(getDetails).toHaveBeenCalledWith(LOG_FILE, false);
  });

  it("clears on NotFound only after the details refresh has landed", async () => {
    queryClient.setQueryData(
      pendingSamplesKey(LOG_DIR, LOG_FILE),
      pending(["a"])
    );
    const { api, getDetails } = await apiWith({ status: "NotFound" });
    let refreshed = false;
    getDetails.mockImplementation(() => {
      refreshed = true;
      return Promise.resolve(runningDetails());
    });

    const result = await fetchPendingSamples(api, LOG_DIR, LOG_FILE);

    expect(result).toBeNull();
    expect(refreshed).toBe(true);
  });

  it("polls with no etag when nothing is cached", async () => {
    const { api, getPending } = await apiWith({ status: "NotModified" });

    const result = await fetchPendingSamples(api, LOG_DIR, LOG_FILE);

    expect(getPending).toHaveBeenCalledWith(LOG_FILE, undefined);
    expect(result).toBeNull();
  });
});
