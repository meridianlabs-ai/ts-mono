// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import Dexie from "dexie";
import { createElement, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { testEvalSpec } from "@tsmono/inspect-common/testing";

import { ClientAPI, Log, LogDetails } from "../client/api/types";
import { DB_NAME } from "../client/database";
import { toLogHeader } from "../client/utils/type-utils";
import { queryClient } from "../state/queryClient";
import { startTestApp } from "../test/testApp";

import { acquireDatabase, releaseDatabase } from "./databaseInstance";
import { fetchEngine } from "./fetchEngine";
import { useLogFetchState, useLogHeader } from "./log";
import {
  clearFile,
  logKey,
  logsKey,
  writeDetails,
  writeListing,
} from "./logsContent";
import {
  activateFetchEngine,
  deactivateFetchEngine,
} from "./replicationControl";
import { testClientAPI, testLogDetails } from "./testFixtures";

const LOG_DIR = "/logs";
const LOG_FILE = "/logs/log.eval";

const makeDetails = (name: string): LogDetails =>
  testLogDetails({
    eval: testEvalSpec({
      eval_id: name,
      run_id: `run-${name}`,
      task: "task",
      model: "m",
    }),
  });

const detailedRow = (name: string): Log => ({
  name,
  depth: "detailed",
  status: "success",
  header: toLogHeader(makeDetails(name)),
  preview_attempts: 0,
  details_attempts: 0,
  details_settled_seq: 0,
});

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client: queryClient }, children);

/**
 * Start the real engine for LOG_DIR with LOG_FILE in the synced listing, as
 * listing sync and <FetchEngineController> leave it below the gate.
 */
const activate = async (api: ClientAPI) => {
  await writeListing(await acquireDatabase(), LOG_DIR, [{ name: LOG_FILE }]);
  activateFetchEngine(
    startTestApp({ api, logDir: LOG_DIR, singleFileMode: false })
  );
};

/** Persist a detailed row for LOG_FILE, as a previous session would have. */
const seedDetailedRow = async () => {
  const db = await acquireDatabase();
  await writeDetails(db, LOG_DIR, { [LOG_FILE]: makeDetails(LOG_FILE) });
  queryClient.clear();
  return db;
};

afterEach(async () => {
  cleanup();
  deactivateFetchEngine();
  await releaseDatabase();
  await Dexie.delete(DB_NAME);
  queryClient.clear();
  vi.restoreAllMocks();
});

describe("useLogHeader", () => {
  it("reports loading while there is neither data nor a retrieval error", async () => {
    // The engine's details fetch stays in flight.
    const getLogDetails = vi.fn(() => new Promise<LogDetails>(() => {}));
    await activate(testClientAPI({ get_log_details: getLogDetails }));

    const { result } = renderHook(
      () => useLogHeader(LOG_DIR, LOG_FILE, { demand: "passive" }),
      {
        wrapper,
      }
    );

    await waitFor(() => expect(getLogDetails).toHaveBeenCalled());
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBeUndefined();
  });

  it("is not loading when no file is given", () => {
    const { result } = renderHook(
      () => useLogHeader(LOG_DIR, undefined, { demand: "passive" }),
      {
        wrapper,
      }
    );

    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBeUndefined();
  });

  it("surfaces the row's retrieval error when it has no header", async () => {
    await activate(
      testClientAPI({
        get_log_details: () => Promise.reject(new Error("boom")),
      })
    );

    const { result } = renderHook(
      () => useLogHeader(LOG_DIR, LOG_FILE, { demand: "passive" }),
      {
        wrapper,
      }
    );

    await waitFor(() => expect(result.current.error?.message).toBe("boom"));
    expect(result.current.data).toBeUndefined();
    expect(result.current.loading).toBe(false);
  });

  it("data wins over a stale retrieval error message", async () => {
    const db = await seedDetailedRow();
    await db.writeFetchStates({
      [LOG_FILE]: {
        preview_attempts: 0,
        details_attempts: 1,
        details_fetch_error: "stale",
        details_settled_seq: 0,
      },
    });

    const { result } = renderHook(
      () => useLogHeader(LOG_DIR, LOG_FILE, { demand: "passive" }),
      {
        wrapper,
      }
    );

    await waitFor(() =>
      expect(result.current.data).toEqual(detailedRow(LOG_FILE).header)
    );
    expect(result.current.error).toBeUndefined();
    expect(result.current.loading).toBe(false);
  });

  it("demands exactly one engine fetch per (dir, file) mount", async () => {
    // Hold the network read, so re-renders land while the fetch is in flight
    // (a re-demand then would be a new engine request, not a cache hit).
    const details = Promise.withResolvers<LogDetails>();
    const getLogDetails = vi.fn((_file: string) => details.promise);
    await activate(testClientAPI({ get_log_details: getLogDetails }));
    const ensure = vi.spyOn(fetchEngine, "ensure");

    const { result, rerender } = renderHook(
      () => useLogHeader(LOG_DIR, LOG_FILE, { demand: "passive" }),
      {
        wrapper,
      }
    );

    await waitFor(() => expect(getLogDetails).toHaveBeenCalledTimes(1));
    rerender();
    rerender();
    details.resolve(makeDetails(LOG_FILE));
    await waitFor(() => expect(result.current.data).toBeDefined());
    // And after landing: a re-demand on any render would be another ensure.
    rerender();
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(ensure.mock.calls[0]?.[0]).toBe(LOG_FILE);
    expect(getLogDetails).toHaveBeenCalledTimes(1);
  });

  it("passive demand on a cached log neither refreshes it nor signals a load", async () => {
    await seedDetailedRow();
    const getLogDetails = vi.fn(() => Promise.resolve(makeDetails(LOG_FILE)));
    await activate(testClientAPI({ get_log_details: getLogDetails }));
    const ensure = vi.spyOn(fetchEngine, "ensure");

    const { result } = renderHook(
      () => ({
        header: useLogHeader(LOG_DIR, LOG_FILE, { demand: "passive" }),
        fetchState: useLogFetchState(LOG_DIR, LOG_FILE),
      }),
      {
        wrapper,
      }
    );

    await waitFor(() => expect(result.current.header.data).toBeDefined());
    // A cache hit settles the demand and issues any refresh in the same
    // step, so once the demand has settled a refresh would have been made.
    await waitFor(() => expect(ensure).toHaveBeenCalledTimes(1));
    await ensure.mock.results[0]?.value;
    expect(getLogDetails).not.toHaveBeenCalled();
    expect(result.current.fetchState.data?.details_settled_seq).toBe(0);
  });

  it("active demand on a cached log refreshes it in the background (the selection binding)", async () => {
    await seedDetailedRow();
    const getLogDetails = vi.fn(() => Promise.resolve(makeDetails(LOG_FILE)));
    await activate(testClientAPI({ get_log_details: getLogDetails }));

    const { result } = renderHook(
      () => useLogHeader(LOG_DIR, LOG_FILE, { demand: "active" }),
      {
        wrapper,
      }
    );

    await waitFor(() => expect(getLogDetails).toHaveBeenCalledTimes(1));
    expect(result.current.data).toBeDefined();
  });

  it("re-seeds from the Dexie row on remount after eviction, without an engine settle", async () => {
    // No engine is active: the database is the only source of the header.
    const db = await seedDetailedRow();
    const readLogRow = vi.spyOn(db, "readLogRow");
    const header = detailedRow(LOG_FILE).header;

    const first = renderHook(
      () => useLogHeader(LOG_DIR, LOG_FILE, { demand: "passive" }),
      {
        wrapper,
      }
    );
    await waitFor(() => expect(first.result.current.data).toEqual(header));
    first.unmount();

    // Simulate gc eviction of the idle entry.
    queryClient.removeQueries({ queryKey: logKey(LOG_DIR, LOG_FILE) });

    const second = renderHook(
      () => useLogHeader(LOG_DIR, LOG_FILE, { demand: "passive" }),
      {
        wrapper,
      }
    );
    await waitFor(() => expect(second.result.current.data).toEqual(header));
    expect(readLogRow).toHaveBeenCalledTimes(2);
    second.unmount();
  });

  it("receives sink pushes while mounted", async () => {
    const details = makeDetails(LOG_FILE);
    const { result } = renderHook(
      () => useLogHeader(LOG_DIR, LOG_FILE, { demand: "passive" }),
      {
        wrapper,
      }
    );
    await waitFor(() => expect(result.current.loading).toBe(true));

    await writeDetails(null, LOG_DIR, { [LOG_FILE]: details });

    // The cache holds the stored form: the payload's header + sample facts.
    await waitFor(() =>
      expect(result.current.data).toEqual(toLogHeader(details))
    );
  });
});

describe("details sink per-entity pushes", () => {
  it("a background writeDetails for an unobserved log creates NO per-entity entry", async () => {
    const details = makeDetails("bg.eval");

    await writeDetails(null, LOG_DIR, { "bg.eval": details });

    expect(
      queryClient.getQueryCache().find({ queryKey: logKey(LOG_DIR, "bg.eval") })
    ).toBeUndefined();
    // The subsystem-internal row collection still gets the detailed row.
    const rows = queryClient.getQueryData<Log[]>(logsKey(LOG_DIR));
    expect(rows?.map((row) => [row.name, row.depth])).toEqual([
      ["bg.eval", "detailed"],
    ]);
    expect(rows?.[0]?.header).toEqual(toLogHeader(details));
  });

  it("clearFile removes the per-entity entry", async () => {
    const row = detailedRow(LOG_FILE);
    queryClient.setQueryData(logKey(LOG_DIR, LOG_FILE), row);

    await clearFile(null, LOG_DIR, LOG_FILE);

    expect(
      queryClient.getQueryCache().find({ queryKey: logKey(LOG_DIR, LOG_FILE) })
    ).toBeUndefined();
  });
});
