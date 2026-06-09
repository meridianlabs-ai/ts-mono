import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clientEventsService } from "./clientEventsService";

describe("ClientEventsService", () => {
  beforeEach(() => {
    clientEventsService.cleanup();
  });

  afterEach(() => {
    clientEventsService.cleanup();
    vi.restoreAllMocks();
  });

  describe("setSyncErrorCallback", () => {
    it("invokes onSyncError when the refresh callback throws", async () => {
      const syncError = vi.fn();
      const boom = new Error("503 Service Unavailable");

      clientEventsService.setRefreshCallback(async () => {
        throw boom;
      });
      clientEventsService.setSyncErrorCallback(syncError);

      const mockApi = {
        client_events: vi.fn().mockResolvedValue(["refresh-evals"]),
      };

      vi.useFakeTimers();
      clientEventsService.startPolling(mockApi as never);

      await vi.waitFor(() => expect(mockApi.client_events).toHaveBeenCalled());
      await vi.waitFor(() => expect(syncError).toHaveBeenCalledWith(boom));

      clientEventsService.stopPolling();
      vi.useRealTimers();
    });

    it("does NOT invoke onSyncError when the refresh callback succeeds", async () => {
      const syncError = vi.fn();

      clientEventsService.setRefreshCallback(async () => {});
      clientEventsService.setSyncErrorCallback(syncError);

      const mockApi = {
        client_events: vi.fn().mockResolvedValue(["refresh-evals"]),
      };

      vi.useFakeTimers();
      clientEventsService.startPolling(mockApi as never);

      await vi.waitFor(() => expect(mockApi.client_events).toHaveBeenCalled());
      clientEventsService.stopPolling();
      vi.useRealTimers();

      expect(syncError).not.toHaveBeenCalled();
    });

    it("clears the callback on cleanup", async () => {
      const syncError = vi.fn();
      clientEventsService.setSyncErrorCallback(syncError);
      clientEventsService.cleanup();

      const mockApi = {
        client_events: vi.fn().mockResolvedValue(["refresh-evals"]),
      };
      clientEventsService.setRefreshCallback(async () => {
        throw new Error("oops");
      });

      vi.useFakeTimers();
      clientEventsService.startPolling(mockApi as never);

      await vi.waitFor(() => expect(mockApi.client_events).toHaveBeenCalled());
      clientEventsService.stopPolling();
      vi.useRealTimers();

      expect(syncError).not.toHaveBeenCalled();
    });
  });
});
