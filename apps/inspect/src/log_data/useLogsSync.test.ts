import { afterEach, describe, expect, it, vi } from "vitest";

import { ClientAPI } from "../client/api/types";
import { queryClient } from "../state/queryClient";

import { clientEventsTick } from "./useLogsSync";

vi.mock("./replicationControl", () => ({ syncLogs: vi.fn() }));

const LOG_DIR = "/logs";
const tickKey = ["log_data", "client-events", LOG_DIR];
const syncKeyForDir = { queryKey: ["log_data", "sync", LOG_DIR] };

const invalidateQueries = vi
  .spyOn(queryClient, "invalidateQueries")
  .mockResolvedValue();

const apiWith = (events: string[]): ClientAPI =>
  ({
    client_events: vi.fn().mockResolvedValue(events),
  }) as unknown as ClientAPI;

afterEach(() => {
  queryClient.clear();
  invalidateQueries.mockClear();
});

describe("clientEventsTick", () => {
  it("invalidates the dir's listing sync on a refresh-evals event", async () => {
    const tick = await clientEventsTick(apiWith(["refresh-evals"]), LOG_DIR);

    expect(tick).toBe(1);
    expect(invalidateQueries).toHaveBeenCalledWith(syncKeyForDir);
  });

  it("does not invalidate on an ordinary tick without events", async () => {
    const tick = await clientEventsTick(apiWith([]), LOG_DIR);

    expect(tick).toBe(1);
    expect(invalidateQueries).not.toHaveBeenCalled();
  });

  it("invalidates periodically every 10th tick", async () => {
    queryClient.setQueryData(tickKey, 9);

    const tick = await clientEventsTick(apiWith([]), LOG_DIR);

    expect(tick).toBe(10);
    expect(invalidateQueries).toHaveBeenCalledWith(syncKeyForDir);
  });

  it("ignores unrelated events", async () => {
    const tick = await clientEventsTick(apiWith(["something-else"]), LOG_DIR);

    expect(tick).toBe(1);
    expect(invalidateQueries).not.toHaveBeenCalled();
  });
});
