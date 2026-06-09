import { useCallback, useEffect } from "react";

import { createLogger } from "@tsmono/util";

import { clientEventsService } from "./clientEventsService";
import { useApi } from "./store";
import { useRefreshLogListing } from "./useLogListing";

const log = createLogger("Client-Events");

export function useClientEvents() {
  const refreshLogListing = useRefreshLogListing();
  const api = useApi();

  const refreshCallback = useCallback(
    async (_reason: "event" | "periodic") => {
      log.debug(`Refresh Log Files (${_reason})`);
      await refreshLogListing();
    },
    [refreshLogListing]
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
