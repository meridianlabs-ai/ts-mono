import { useCallback, useEffect, useRef } from "react";

import { LogHandle } from "@tsmono/inspect-common";
import { createLogger } from "@tsmono/util";

import { LogPreview } from "../client/api/types";

import { clientEventsService } from "./clientEventsService";
import { useLogs } from "./hooks";
import { useApi, useStore } from "./store";

const log = createLogger("Client-Events");

export function useClientEvents() {
  const syncLogs = useStore((state) => state.logsActions.syncLogs);
  const logPreviews = useStore((state) => state.logs.logPreviews);
  const currentLogs = useStore((state) => state.logs.logs);
  const api = useApi();
  const { loadLogOverviews } = useLogs();

  // Refs so the callback always sees the latest values without
  // re-creating itself (which would restart polling).
  const logPreviewsRef = useRef<Record<string, LogPreview>>(logPreviews);
  logPreviewsRef.current = logPreviews;

  const currentLogsRef = useRef<LogHandle[]>(currentLogs);
  currentLogsRef.current = currentLogs;

  const refreshCallback = useCallback(
    async (_reason: "event" | "periodic") => {
      log.debug(`Refresh Log Files (${_reason})`);
      await syncLogs();

      // Read current state *after* sync completes
      const logs = currentLogsRef.current;
      const previews = logPreviewsRef.current;

      const toRefresh: LogHandle[] = [];
      for (const logHandle of logs) {
        const header = previews[logHandle.name];
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
