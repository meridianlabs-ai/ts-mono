import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LogDetails } from "../client/api/types";
import { LogFetchStateRecord } from "../client/database";
import { queryClient } from "../state/queryClient";

import { useLogDetail } from "./logDetail";
import {
  clearFile,
  logDetailKey,
  logDetailsKey,
  writeDetails,
} from "./logsContent";

const fetchLog = vi.hoisted(() => vi.fn());
vi.mock("./replicationControl", () => ({ fetchLog }));

const db = vi.hoisted(() => ({
  opened: vi.fn(() => false),
  readLogDetailsForFile: vi.fn(),
  readFetchStates: vi.fn(),
}));
vi.mock("./databaseServiceInstance", () => ({
  getDatabaseService: () => db,
}));

const LOG_DIR = "/logs";
const LOG_FILE = "log.eval";

const makeDetails = (name: string): LogDetails =>
  ({
    version: 2,
    status: "success",
    eval: { eval_id: name, run_id: `run-${name}`, task: "task", model: "m" },
    sampleSummaries: [],
  }) as unknown as LogDetails;

const fetchStateWithError = (
  name: string,
  message: string
): LogFetchStateRecord => ({
  file_path: name,
  preview_attempts: 0,
  details_attempts: 1,
  details_fetch_error: message,
  details_settled_seq: 0,
  updated_at: new Date().toISOString(),
});

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client: queryClient }, children);

// A promise that never settles — the engine fetch staying in flight.
const pendingForever = () => new Promise<LogDetails>(() => {});

beforeEach(() => {
  fetchLog.mockReset();
  fetchLog.mockImplementation(pendingForever);
  db.opened.mockReset();
  db.opened.mockReturnValue(false);
  db.readLogDetailsForFile.mockReset();
  db.readLogDetailsForFile.mockResolvedValue(null);
  db.readFetchStates.mockReset();
  db.readFetchStates.mockResolvedValue({});
});

afterEach(() => {
  queryClient.clear();
});

describe("useLogDetail", () => {
  it("reports loading while there is neither data nor a retrieval error", async () => {
    const { result } = renderHook(() => useLogDetail(LOG_DIR, LOG_FILE), {
      wrapper,
    });

    await waitFor(() => expect(result.current.loading).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBeUndefined();
  });

  it("is not loading when no file is given", () => {
    const { result } = renderHook(() => useLogDetail(LOG_DIR, undefined), {
      wrapper,
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBeUndefined();
  });

  it("surfaces the fetch-state retrieval error when there is no data row", async () => {
    db.opened.mockReturnValue(true);
    db.readFetchStates.mockResolvedValue({
      [LOG_FILE]: fetchStateWithError(LOG_FILE, "boom"),
    });

    const { result } = renderHook(() => useLogDetail(LOG_DIR, LOG_FILE), {
      wrapper,
    });

    await waitFor(() => expect(result.current.error?.message).toBe("boom"));
    expect(result.current.data).toBeUndefined();
    expect(result.current.loading).toBe(false);
  });

  it("data wins over a stale retrieval error message", async () => {
    const details = makeDetails(LOG_FILE);
    db.opened.mockReturnValue(true);
    db.readLogDetailsForFile.mockResolvedValue(details);
    db.readFetchStates.mockResolvedValue({
      [LOG_FILE]: fetchStateWithError(LOG_FILE, "stale"),
    });

    const { result } = renderHook(() => useLogDetail(LOG_DIR, LOG_FILE), {
      wrapper,
    });

    await waitFor(() => expect(result.current.data).toBe(details));
    expect(result.current.error).toBeUndefined();
    expect(result.current.loading).toBe(false);
  });

  it("demands exactly one engine fetch per (dir, file) mount", async () => {
    const { result, rerender } = renderHook(
      () => useLogDetail(LOG_DIR, LOG_FILE),
      { wrapper }
    );

    await waitFor(() => expect(fetchLog).toHaveBeenCalledTimes(1));
    expect(fetchLog).toHaveBeenCalledWith(LOG_DIR, LOG_FILE);

    rerender();
    expect(fetchLog).toHaveBeenCalledTimes(1);
    expect(result.current.loading).toBe(true);
  });

  it("re-seeds from the Dexie row on remount after eviction, without an engine settle", async () => {
    const details = makeDetails(LOG_FILE);
    db.opened.mockReturnValue(true);
    db.readLogDetailsForFile.mockResolvedValue(details);

    const first = renderHook(() => useLogDetail(LOG_DIR, LOG_FILE), {
      wrapper,
    });
    await waitFor(() => expect(first.result.current.data).toBe(details));
    first.unmount();

    // Simulate gc eviction of the idle entry.
    queryClient.removeQueries({ queryKey: logDetailKey(LOG_DIR, LOG_FILE) });

    const second = renderHook(() => useLogDetail(LOG_DIR, LOG_FILE), {
      wrapper,
    });
    await waitFor(() => expect(second.result.current.data).toBe(details));
    expect(db.readLogDetailsForFile).toHaveBeenCalledTimes(2);
    second.unmount();
  });

  it("receives sink pushes while mounted", async () => {
    const details = makeDetails(LOG_FILE);
    const { result } = renderHook(() => useLogDetail(LOG_DIR, LOG_FILE), {
      wrapper,
    });
    await waitFor(() => expect(result.current.loading).toBe(true));

    await writeDetails(null, LOG_DIR, { [LOG_FILE]: details });

    await waitFor(() => expect(result.current.data).toBe(details));
  });
});

describe("details sink per-handle pushes", () => {
  it("a background writeDetails for an unobserved log creates NO per-handle entry", async () => {
    const details = makeDetails("bg.eval");

    await writeDetails(null, LOG_DIR, { "bg.eval": details });

    expect(
      queryClient
        .getQueryCache()
        .find({ queryKey: logDetailKey(LOG_DIR, "bg.eval") })
    ).toBeUndefined();
    // The transitional whole-dir map still gets the row (listing feed).
    expect(
      queryClient.getQueryData<Record<string, LogDetails>>(
        logDetailsKey(LOG_DIR)
      )
    ).toEqual({ "bg.eval": details });
  });

  it("clearFile removes the per-handle detail entry", async () => {
    const details = makeDetails(LOG_FILE);
    queryClient.setQueryData(logDetailKey(LOG_DIR, LOG_FILE), details);

    await clearFile(null, LOG_DIR, LOG_FILE);

    expect(
      queryClient
        .getQueryCache()
        .find({ queryKey: logDetailKey(LOG_DIR, LOG_FILE) })
    ).toBeUndefined();
  });
});
