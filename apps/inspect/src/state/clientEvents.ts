import { useCallback, useEffect } from "react";

import { createLogger } from "@tsmono/util";

import { useApi } from "../app_config";
import { syncLogs } from "../log_data";

import { clientEventsService } from "./clientEventsService";

const log = createLogger("Client-Events");

export function useClientEvents() {
  const api = useApi();

  const refreshCallback = useCallback(async (_reason: "event" | "periodic") => {
    log.debug(`Refresh Log Files (${_reason})`);
    await syncLogs();
  }, []);

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
