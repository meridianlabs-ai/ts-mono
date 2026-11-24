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
import {
  clientEventsTick,
  invalidateLogListing,
  useLogsSync,
} from "./useLogsSync";

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

  it("splits a failed first sync (error) from a failed re-sync (refreshError)", async () => {
    const getLogs = vi
      .fn<() => Promise<LogFilesResponse>>()
      .mockRejectedValueOnce(new Error("first sync failed"))
      .mockResolvedValueOnce(listing([]))
      .mockRejectedValueOnce(new Error("re-sync failed"))
      .mockResolvedValue(listing([]));
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

    // Nothing has synced yet: the failure blocks.
    await waitFor(() =>
      expect(result.current.error?.message).toBe("first sync failed")
    );
    expect(result.current.refreshError).toBeUndefined();

    // Refetching clears `error` while pending, so wait for the success to
    // settle before invalidating again (or the next fetch dedupes onto it).
    invalidateLogListing();
    await waitFor(() => {
      expect(getLogs).toHaveBeenCalledTimes(2);
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.error).toBeUndefined();
    expect(result.current.refreshError).toBeUndefined();

    // A listing has synced: the failure is a refresh error, not a blocking one.
    invalidateLogListing();
    await waitFor(() =>
      expect(result.current.refreshError?.message).toBe("re-sync failed")
    );
    expect(result.current.error).toBeUndefined();

    invalidateLogListing();
    await waitFor(() => expect(result.current.refreshError).toBeUndefined());
    expect(result.current.error).toBeUndefined();
  });

  it("reports a failed sync in a never-visited folder as a refresh error once the dir has synced", async () => {
    const getLogs = vi
      .fn<() => Promise<LogFilesResponse>>()
      .mockResolvedValueOnce(listing([]))
      .mockRejectedValue(new Error("server down"));
    activateFetchEngine(
      resolveConfig(
        testClientAPI({
          client_events: () => Promise.resolve([]),
          get_logs: getLogs,
        }),
        false
      )
    );

    const root = renderHook(() => useLogsSync(LOG_DIR, ""), { wrapper });
    await waitFor(() => {
      expect(getLogs).toHaveBeenCalledTimes(1);
      expect(root.result.current.loading).toBe(false);
    });

    // A new folder is a new sync query, but the dir already synced.
    const sub = renderHook(() => useLogsSync(LOG_DIR, "sub"), { wrapper });
    await waitFor(() =>
      expect(sub.result.current.refreshError?.message).toBe("server down")
    );
    expect(sub.result.current.error).toBeUndefined();
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
