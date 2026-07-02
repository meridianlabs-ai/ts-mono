import { useCallback, useEffect } from "react";

import { createLogger } from "@tsmono/util";

import { useAppConfig } from "../app/server/useAppConfig";

import { clientEventsService } from "./clientEventsService";
import { syncLogs } from "./replicationControl";

const log = createLogger("Client-Events");

export function useClientEvents() {
  const { api } = useAppConfig();

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
