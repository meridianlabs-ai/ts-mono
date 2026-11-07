// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { testEvalSpec } from "@tsmono/inspect-common/testing";

import { APP_CONFIG_KEY } from "../app_config";
import {
  testClientAPI,
  testLogDetails,
  testSampleSummary,
} from "../client/api/testClientApi";
import { ClientAPI, LogDetails, RunningMetric } from "../client/api/types";
import { OpenDatabase } from "../client/database";
import { useLogHeader } from "../log_data";
import { atRoute, startTestApp, stopTestApp } from "../test/testApp";

import { useSelectedRunningMetrics, useSelectedSampleSummaries } from "./hooks";
import { queryClient } from "./queryClient";
import {
  useSelectedLogDetail,
  useSelectedLogLoading,
} from "./selectedLogDetails";

// The selection bindings read the route's log and delegate to the
// param-driven acquisition hooks; render them below a real route and
// selection over the real data layer, and assert what reaches them.

const LOG_DIR = "/logs";
const LOG_FILE = "/logs/run.eval";

const details = (overrides: Partial<LogDetails> = {}): LogDetails =>
  testLogDetails({
    eval: testEvalSpec({ task: "run-task" }),
    sampleSummaries: [testSampleSummary({ id: "s1" })],
    ...overrides,
  });

const start = (api: ClientAPI) => startTestApp({ logDir: LOG_DIR, api });

afterEach(async () => {
  cleanup();
  await stopTestApp();
});

describe("useSelectedRunningMetrics", () => {
  it("serves the selected running log's metrics", async () => {
    const metric: RunningMetric = { scorer: "match", name: "accuracy" };
    start(
      testClientAPI({
        get_log_details: () => Promise.resolve(details({ status: "started" })),
        get_log_info: () => Promise.resolve({ size: 1 }),
        get_log_pending_samples: () =>
          Promise.resolve({
            status: "OK",
            pendingSamples: { samples: [], refresh: 2, metrics: [metric] },
          }),
      })
    );

    const { result } = renderHook(() => useSelectedRunningMetrics(), {
      wrapper: atRoute("/logs/run.eval"),
    });

    await waitFor(() => expect(result.current.data).toEqual([metric]));
  });
});

describe("useSelectedLogDetail", () => {
  it("serves the selected log's header", async () => {
    const getLogDetails = vi.fn((_file: string) => Promise.resolve(details()));
    start(testClientAPI({ get_log_details: getLogDetails }));

    const { result } = renderHook(() => useSelectedLogDetail(), {
      wrapper: atRoute("/logs/run.eval"),
    });

    await waitFor(() =>
      expect(result.current.data?.eval.task).toBe("run-task")
    );
    expect(getLogDetails.mock.calls[0]?.[0]).toBe(LOG_FILE);
  });

  it("demands the selected log actively: reopening it signals a load", async () => {
    // Active demand is the one consumer that bumps the log's settle seq —
    // the "a log was opened" signal LogLoadController keys off — including
    // when the log is served from the local database (see F2 in
    // fetchEngine.test.ts). Directory mode, over fake-indexeddb.
    const config = startTestApp({
      logDir: LOG_DIR,
      singleFileMode: false,
      api: testClientAPI({ get_log_details: () => Promise.resolve(details()) }),
    });

    // An earlier visit, by a passive consumer, caches the log locally.
    const visit = renderHook(
      () => useLogHeader(LOG_DIR, LOG_FILE, { demand: "passive" }),
      { wrapper: atRoute() }
    );
    await waitFor(() => expect(visit.result.current.data).toBeDefined());
    visit.unmount();
    queryClient.clear();
    queryClient.setQueryData(APP_CONFIG_KEY, config);

    const db = await OpenDatabase.open();
    await waitFor(async () =>
      expect((await db.readLogRow(LOG_FILE))?.depth).toBe("detailed")
    );
    expect((await db.readLogRow(LOG_FILE))?.details_settled_seq).toBe(0);

    const { result } = renderHook(() => useSelectedLogDetail(), {
      wrapper: atRoute("/logs/run.eval"),
    });

    await waitFor(() => expect(result.current.data).toBeDefined());
    await waitFor(async () =>
      expect((await db.readLogRow(LOG_FILE))?.details_settled_seq).toBe(1)
    );
    db.close();
  });
});

describe("useSelectedLogLoading", () => {
  it("is false when no file is selected", () => {
    start(testClientAPI());

    const { result } = renderHook(() => useSelectedLogLoading(), {
      wrapper: atRoute("/logs"),
    });

    expect(result.current).toBe(false);
  });
});

describe("useSelectedSampleSummaries", () => {
  it("serves the selected log's sample summaries", async () => {
    start(testClientAPI({ get_log_details: () => Promise.resolve(details()) }));

    const { result } = renderHook(() => useSelectedSampleSummaries(), {
      wrapper: atRoute("/logs/run.eval"),
    });

    await waitFor(() =>
      expect(result.current.data?.map((summary) => summary.id)).toEqual(["s1"])
    );
  });
});
