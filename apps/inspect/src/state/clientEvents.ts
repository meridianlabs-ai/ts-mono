import { useCallback, useEffect } from "react";

import { LogHandle } from "@tsmono/inspect-common";
import { createLogger } from "@tsmono/util";

import { clientEventsService } from "./clientEventsService";
import { useLogs } from "./hooks";
import { storeImplementation, useApi, useStore } from "./store";

const log = createLogger("Client-Events");

export function useClientEvents() {
  const syncLogs = useStore((state) => state.logsActions.syncLogs);
  const api = useApi();
  const { loadLogOverviews } = useLogs();

  const refreshCallback = useCallback(
    async (_reason: "event" | "periodic") => {
      log.debug(`Refresh Log Files (${_reason})`);
      const currentLogs = await syncLogs();

      // Read previews from the store *after* sync so we see the
      // latest state rather than a stale closure capture.
      const logPreviews = storeImplementation?.getState()?.logs.logPreviews;

      const toRefresh: LogHandle[] = [];
      for (const logHandle of currentLogs) {
        const header = logPreviews?.[logHandle.name];
        if (!header || header.status === "started") {
          toRefresh.push(logHandle);
        }
      }

      if (toRefresh.length > 0) {
        log.debug(`Refreshing ${toRefresh.length} log files`, toRefresh);
        await loadLogOverviews(toRefresh);
      }
    },
    [syncLogs, loadLogOverviews]
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
