import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";

import { createLogger } from "@tsmono/util";

import { clientEventsService } from "./clientEventsService";
import { useApi, useStore } from "./store";
import { logListingQueryKey } from "./useLogListing";

const log = createLogger("Client-Events");

export function useClientEvents() {
  const queryClient = useQueryClient();
  const logDir = useStore((state) => state.logs.logDir);
  const api = useApi();

  const refreshCallback = useCallback(
    async (_reason: "event" | "periodic") => {
      log.debug(`Refresh Log Files (${_reason})`);
      await queryClient.invalidateQueries({
        queryKey: logListingQueryKey(logDir),
      });
    },
    [queryClient, logDir]
  );

  useEffect(() => {
    clientEventsService.setRefreshCallback(refreshCallback);
  }, [refreshCallback]);

  const startPolling = useCallback(() => {
    clientEventsService.startPolling(api);
  }, [api]);

  const stopPolling = useCallback(() => {
    clientEventsService.stopPolling();
  }, []);

  const cleanup = useCallback(() => {
    clientEventsService.cleanup();
  }, []);

  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return {
    startPolling,
    stopPolling,
    cleanup,
  };
}
