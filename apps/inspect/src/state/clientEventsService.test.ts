import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clientEventsService } from "./clientEventsService";

describe("ClientEventsService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clientEventsService.cleanup();
  });

  afterEach(() => {
    clientEventsService.cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("refreshCallback error handling", () => {
    it("does not propagate throws from the refresh callback", async () => {
      clientEventsService.setRefreshCallback(async () => {
        throw new Error("503 Service Unavailable");
      });

      const mockApi = {
        client_events: vi.fn().mockResolvedValue(["refresh-evals"]),
      };

      clientEventsService.startPolling(mockApi as never);

      await vi.waitFor(() => expect(mockApi.client_events).toHaveBeenCalled());
      clientEventsService.stopPolling();
    });
  });
});
