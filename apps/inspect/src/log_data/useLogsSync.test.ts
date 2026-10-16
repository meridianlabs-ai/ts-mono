// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import Dexie from "dexie";
import { createElement, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LogFilesResponse } from "@tsmono/inspect-common/types";

import { ClientAPI } from "../client/api/types";
import { DB_NAME } from "../client/database";
import { queryClient } from "../state/queryClient";
import { startTestApp } from "../test/testApp";

import { releaseDatabase } from "./databaseInstance";
import {
  activateFetchEngine,
  deactivateFetchEngine,
} from "./replicationControl";
import { testClientAPI } from "./testFixtures";
import { clientEventsTick, useLogsSync } from "./useLogsSync";

const LOG_DIR = "/logs";
const tickKey = ["log_data", "client-events", LOG_DIR];
// The listing-sync query a panel mounted at the dir root subscribes.
const syncKey = ["log_data", "sync", LOG_DIR, ""];

const apiWith = (events: string[]): ClientAPI =>
  testClientAPI({
    client_events: vi.fn().mockResolvedValue(events),
  });

const resolveConfig = (api: ClientAPI, singleFileMode: boolean) =>
  startTestApp({ api, logDir: LOG_DIR, singleFileMode });

const listing = (names: string[]): LogFilesResponse => ({
  files: names.map((name) => ({ name, mtime: 1 })),
  response_type: "full",
});

afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  deactivateFetchEngine();
  await releaseDatabase();
  await Dexie.delete(DB_NAME);
  queryClient.clear();
});

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client: queryClient }, children);

describe("clientEventsTick", () => {
  // A subscribed panel's sync query, so invalidation is observable on it.
  const seedSyncQuery = () => queryClient.setQueryData(syncKey, []);
  const syncInvalidated = () =>
    queryClient.getQueryState(syncKey)?.isInvalidated;

  it("invalidates the dir's listing sync on a refresh-evals event", async () => {
    seedSyncQuery();

    const tick = await clientEventsTick(apiWith(["refresh-evals"]), LOG_DIR);

    expect(tick).toBe(1);
    expect(syncInvalidated()).toBe(true);
  });

  it("does not invalidate on an ordinary tick without events", async () => {
    seedSyncQuery();

    const tick = await clientEventsTick(apiWith([]), LOG_DIR);

    expect(tick).toBe(1);
    expect(syncInvalidated()).toBe(false);
  });

  it("invalidates periodically every 10th tick", async () => {
    seedSyncQuery();
    queryClient.setQueryData(tickKey, 9);

    const tick = await clientEventsTick(apiWith([]), LOG_DIR);

    expect(tick).toBe(10);
    expect(syncInvalidated()).toBe(true);
  });

  it("ignores unrelated events", async () => {
    seedSyncQuery();

    const tick = await clientEventsTick(apiWith(["something-else"]), LOG_DIR);

    expect(tick).toBe(1);
    expect(syncInvalidated()).toBe(false);
  });
});

describe("useLogsSync", () => {
  it("keeps polling client events after ticks fail (a transient outage must not park freshness)", async () => {
    vi.useFakeTimers();
    const clientEvents = vi.fn(() =>
      Promise.reject<string[]>(new Error("server down"))
    );
    // Single-file mode: the listing sync no-ops, leaving only the poll.
    resolveConfig(testClientAPI({ client_events: clientEvents }), true);

    renderHook(() => useLogsSync(LOG_DIR, ""), { wrapper });

    // Well past any retry window: the tick query has settled into error.
    await vi.advanceTimersByTimeAsync(30_000);
    const settledCalls = clientEvents.mock.calls.length;

    // The poll must still be alive: more ticks arrive on the interval.
    await vi.advanceTimersByTimeAsync(20_000);
    expect(clientEvents.mock.calls.length).toBeGreaterThan(settledCalls);
  });

  it("reports loading while the listing sync is in flight, then settles", async () => {
    let resolveLogs!: (value: LogFilesResponse) => void;
    const getLogs = vi.fn(
      () => new Promise<LogFilesResponse>((resolve) => (resolveLogs = resolve))
    );
    activateFetchEngine(
      resolveConfig(
        testClientAPI({
          client_events: () => Promise.resolve([]),
          get_logs: getLogs,
        }),
        false
      )
    );

    const { result } = renderHook(() => useLogsSync(LOG_DIR, ""), { wrapper });

    await waitFor(() => expect(getLogs).toHaveBeenCalled());
    expect(result.current.loading).toBe(true);
    expect(result.current.busy).toBe(true);

    resolveLogs(listing([]));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.busy).toBe(false);
  });

  it("folds engine background fetching into busy but not loading", async () => {
    // The synced listing has a file whose preview backfill never settles.
    const getSummaries = vi.fn(() => new Promise<never>(() => {}));
    activateFetchEngine(
      resolveConfig(
        testClientAPI({
          client_events: () => Promise.resolve([]),
          get_logs: () => Promise.resolve(listing(["/logs/a.eval"])),
          get_log_summaries_settled: getSummaries,
        }),
        false
      )
    );

    const { result } = renderHook(() => useLogsSync(LOG_DIR, ""), { wrapper });

    await waitFor(() => expect(getSummaries).toHaveBeenCalled());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.busy).toBe(true);
  });
});
