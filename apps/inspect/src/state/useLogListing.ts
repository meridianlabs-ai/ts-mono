import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { LogHandle } from "@tsmono/inspect-common/types";
import { useAsyncDataFromQuery } from "@tsmono/react/hooks";
import { AsyncData } from "@tsmono/util";

import { ClientAPI } from "../client/api/types";

import { useApi, useStore } from "./store";
import { ReplicationService } from "./sync/replicationService";
import { computeSyncCursor } from "./sync/syncCursor";

export interface FetchAndApplyDeps {
  api: ClientAPI;
  replication: ReplicationService | undefined | null;
  readCachedLogs: () => Promise<LogHandle[]>;
}

export async function fetchAndApplyListing(
  deps: FetchAndApplyDeps
): Promise<LogHandle[]> {
  const { api, replication, readCachedLogs } = deps;
  // The service instance always exists; only fetch once startReplication has
  // wired it up. Premature runs (query mounts before setup) no-op; the
  // ensureReplicationReady tail invalidation re-runs this once ready.
  if (!replication || !replication.isReplicating()) return [];
  const cached = await readCachedLogs();
  const { mtime, clientFileCount, staticList } = computeSyncCursor(cached);
  // A static list has no mtimes; fetch with a zero count to force a full
  // response the apply step can diff against.
  const response = staticList
    ? await api.get_logs(0, 0)
    : await api.get_logs(mtime, clientFileCount);
  return replication.applyServerListing(response, cached);
}

export function logListingQueryKey(logDir: string | undefined) {
  return ["log-files", logDir ?? "__default__"] as const;
}

// Prefix filter: TanStack does partial matching, so ["log-files"] hits any ["log-files", dir].
export const logListingQueryFilter = { queryKey: ["log-files"] } as const;

export function useRefreshLogListing(): () => Promise<void> {
  const queryClient = useQueryClient();
  return useCallback(
    () => queryClient.invalidateQueries(logListingQueryFilter),
    [queryClient]
  );
}

// Mirrors useAppConfigAsync (app/server/useAppConfig.ts).
export function useLogListing(
  logDir: string | undefined
): AsyncData<LogHandle[]> {
  const api = useApi();
  const replication = useStore((state) => state.replicationService);
  const databaseService = useStore((state) => state.databaseService);

  return useAsyncDataFromQuery({
    queryKey: logListingQueryKey(logDir),
    queryFn: () =>
      fetchAndApplyListing({
        api,
        replication,
        readCachedLogs: async () => (await databaseService?.readLogs()) || [],
      }),
    staleTime: Infinity,
  });
}
