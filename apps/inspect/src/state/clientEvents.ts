import { useCallback, useEffect } from "react";

import { createLogger } from "@tsmono/util";

import { clientEventsService } from "./clientEventsService";
import { useApi, useStore } from "./store";

const log = createLogger("Client-Events");

export function useClientEvents() {
  const syncLogs = useStore((state) => state.logsActions.syncLogs);
  const setSyncError = useStore((state) => state.appActions.setSyncError);
  const api = useApi();

  const refreshCallback = useCallback(
    async (_reason: "event" | "periodic") => {
      log.debug(`Refresh Log Files (${_reason})`);
      setSyncError(undefined);
      try {
        await syncLogs();
      } catch (e) {
        setSyncError(e as Error);
      }
    },
    [syncLogs, setSyncError]
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
