import { useQuery } from "@tanstack/react-query";

import { LogHandle } from "@tsmono/inspect-common/types";
import { useAsyncDataFromQuery } from "@tsmono/react/hooks";
import { AsyncData } from "@tsmono/util";

import { getApi, useLogDir } from "../app_config";
import { ClientAPI } from "../client/api/types";
import { queryClient } from "../state/queryClient";

import { syncLogs } from "./replicationControl";

const logsSyncKey = ["logs-sync"] as const;

const kRefreshEvent = "refresh-evals";
const kClientEventsIntervalMs = 5_000;
// Every Nth tick re-syncs the listing even without a refresh event, so
// changes the host doesn't announce (e.g. files landing in the dir) are
// still picked up.
const kPeriodicRefreshTicks = 10;

const clientEventsKey = (logDir: string) => ["client-events", logDir] as const;

/**
 * One client-events poll tick (the queryFn; exported for tests): ask the host
 * for events and re-run the listing sync on a `refresh-evals` event or every
 * `kPeriodicRefreshTicks`th tick. The query data is the tick counter.
 */
export const clientEventsTick = async (
  api: ClientAPI,
  logDir: string
): Promise<number> => {
  const events = await api.client_events();
  const tick =
    (queryClient.getQueryData<number>(clientEventsKey(logDir)) ?? 0) + 1;
  if (events.includes(kRefreshEvent) || tick % kPeriodicRefreshTicks === 0) {
    await syncLogs(logDir);
  }
  return tick;
};

/**
 * Sync the log listing for a mounted panel, as a react-query query: the
 * panel's loading / error states derive from its AsyncData (nothing sets a
 * loading flag imperatively). The listing data itself flows through the
 * logsContent collections via the engine's sink — this query only triggers
 * discovery and carries its status. Keyed by the panel's path scope so
 * navigating between folders re-syncs. No-ops (settling to []) in single-file
 * mode.
 *
 * Subscribing also keeps the listing *fresh*: a client-events poll (shared
 * across subscribers via its `logDir` key) re-syncs on host `refresh-evals`
 * events and periodically. Poll lifetime is subscriber lifetime — no
 * imperative start/stop.
 */
export const useLogsSync = (scope: string): AsyncData<LogHandle[]> => {
  const logDir = useLogDir();
  useQuery({
    queryKey: clientEventsKey(logDir),
    queryFn: () => clientEventsTick(getApi(), logDir),
    // A failed tick retries per the client default, then parks the query in
    // error state; stopping the interval there is the give-up.
    refetchInterval: (query) =>
      query.state.status === "error" ? false : kClientEventsIntervalMs,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  return useAsyncDataFromQuery({
    queryKey: [...logsSyncKey, logDir, scope],
    queryFn: () => syncLogs(logDir),
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
};

/**
 * Request listing freshness (external event / user refresh): invalidate the
 * listing-sync queries, re-running `syncLogs` for whichever panels are
 * subscribed. With no subscriber mounted nothing refetches — freshness is
 * subscriber-driven.
 */
export const refreshLogListing = (): Promise<void> =>
  queryClient.invalidateQueries({ queryKey: logsSyncKey });
