import { useCallback, useEffect } from "react";

import { createLogger } from "@tsmono/util";

import { getApi } from "../app_config";
import { syncLogs } from "../log_data";

import { clientEventsService } from "./clientEventsService";

const log = createLogger("Client-Events");

/**
 * Controls for the client-events polling service (start/stop/cleanup).
 *
 * Used to obtain action functions only — no data; mounting only registers
 * the refresh callback and unmount cleanup.
 */
export function useClientEventsActions() {
  const api = getApi();

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
