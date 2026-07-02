import { afterEach, describe, expect, it, vi } from "vitest";

import { ClientAPI } from "../client/api/types";
import { queryClient } from "../state/queryClient";

import { clientEventsTick } from "./useLogsSync";

const syncLogs = vi.hoisted(() => vi.fn());
vi.mock("./replicationControl", () => ({ syncLogs }));

const LOG_DIR = "/logs";
const tickKey = ["client-events", LOG_DIR];

const apiWith = (events: string[]): ClientAPI =>
  ({
    client_events: vi.fn().mockResolvedValue(events),
  }) as unknown as ClientAPI;

afterEach(() => {
  queryClient.clear();
  syncLogs.mockReset();
});

describe("clientEventsTick", () => {
  it("re-syncs the listing on a refresh-evals event", async () => {
    const tick = await clientEventsTick(apiWith(["refresh-evals"]), LOG_DIR);

    expect(tick).toBe(1);
    expect(syncLogs).toHaveBeenCalledWith(LOG_DIR);
  });

  it("does not re-sync on an ordinary tick without events", async () => {
    const tick = await clientEventsTick(apiWith([]), LOG_DIR);

    expect(tick).toBe(1);
    expect(syncLogs).not.toHaveBeenCalled();
  });

  it("re-syncs periodically every 10th tick", async () => {
    queryClient.setQueryData(tickKey, 9);

    const tick = await clientEventsTick(apiWith([]), LOG_DIR);

    expect(tick).toBe(10);
    expect(syncLogs).toHaveBeenCalledWith(LOG_DIR);
  });

  it("ignores unrelated events", async () => {
    const tick = await clientEventsTick(apiWith(["something-else"]), LOG_DIR);

    expect(tick).toBe(1);
    expect(syncLogs).not.toHaveBeenCalled();
  });
});
