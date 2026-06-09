import { useCallback, useEffect } from "react";

import { createLogger } from "@tsmono/util";

import { clientEventsService } from "./clientEventsService";
import { storeImplementation, useApi, useStore } from "./store";

const log = createLogger("Client-Events");

export function useClientEvents() {
  const syncLogs = useStore((state) => state.logsActions.syncLogs);
  const setSyncError = useStore((state) => state.appActions.setSyncError);
  const promoteErrorToSyncError = useStore(
    (state) => state.appActions.promoteErrorToSyncError
  );
  const api = useApi();

  const refreshCallback = useCallback(
    async (_reason: "event" | "periodic") => {
      log.debug(`Refresh Log Files (${_reason})`);
      setSyncError(undefined);
      const errorBefore = storeImplementation!.getState().app.status.error;
      try {
        await syncLogs();
      } catch (e) {
        setSyncError(e as Error);
        return;
      }
      // initLogDir writes network errors directly to the global error slot.
      // On the background polling path that would replace the full UI — move
      // any newly-set error to syncError instead.
      const errorAfter = storeImplementation!.getState().app.status.error;
      if (errorAfter && errorAfter !== errorBefore) {
        promoteErrorToSyncError();
      }
    },
    [syncLogs, setSyncError, promoteErrorToSyncError]
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
