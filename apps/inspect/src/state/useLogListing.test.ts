import { describe, expect, it, vi } from "vitest";

import { LogFilesResponse, LogHandle } from "@tsmono/inspect-common/types";

import { fetchAndApplyListing } from "./useLogListing";

const handle = (name: string, mtime: number): LogHandle => ({
  name,
  task: null,
  task_id: null,
  mtime,
});

describe("fetchAndApplyListing", () => {
  it("fetches with the cached cursor and applies the response", async () => {
    const cached = [handle("a.eval", 100)];
    const response: LogFilesResponse = {
      response_type: "incremental",
      files: [handle("a.eval", 100), handle("b.eval", 200)],
    };
    const get_logs = vi.fn().mockResolvedValue(response);
    const applyServerListing = vi.fn().mockResolvedValue(response.files);

    const result = await fetchAndApplyListing({
      api: { get_logs } as any,
      replication: { applyServerListing, isReplicating: () => true } as any,
      readCachedLogs: async () => cached,
    });

    // cursor from cached: mtime=100, count=1 (not static)
    expect(get_logs).toHaveBeenCalledWith(100, 1);
    expect(applyServerListing).toHaveBeenCalledWith(response, cached);
    expect(result).toEqual(response.files);
  });

  it("forces a full fetch (count 0) for a static list", async () => {
    const cached = [handle("a.eval", 0), handle("b.eval", 0)];
    const response: LogFilesResponse = {
      response_type: "full",
      files: cached,
    };
    const get_logs = vi.fn().mockResolvedValue(response);
    const applyServerListing = vi.fn().mockResolvedValue(response.files);

    await fetchAndApplyListing({
      api: { get_logs } as any,
      replication: { applyServerListing, isReplicating: () => true } as any,
      readCachedLogs: async () => cached,
    });

    // static list (files, no mtimes) -> get_logs(0, 0) forces a full response
    expect(get_logs).toHaveBeenCalledWith(0, 0);
  });

  it("returns an empty list when there is no replication context", async () => {
    const get_logs = vi.fn();
    const result = await fetchAndApplyListing({
      api: { get_logs } as any,
      replication: undefined,
      readCachedLogs: async () => [],
    });
    expect(result).toEqual([]);
    expect(get_logs).not.toHaveBeenCalled();
  });

  it("no-ops when the replication service is not yet wired up", async () => {
    const get_logs = vi.fn();
    const result = await fetchAndApplyListing({
      api: { get_logs } as any,
      replication: {
        applyServerListing: vi.fn(),
        isReplicating: () => false,
      } as any,
      readCachedLogs: async () => [],
    });
    expect(result).toEqual([]);
    expect(get_logs).not.toHaveBeenCalled();
  });
});
