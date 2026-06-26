import { useQuery } from "@tanstack/react-query";

import { LogHandle } from "@tsmono/inspect-common/types";

import { LogDetails, LogPreview } from "../client/api/types";

import { queryClient } from "./queryClient";

/**
 * The asynchronously-retrieved log-list content (handles + previews + details),
 * owned by the react-query cache rather than zustand. The ReplicationService
 * streams updates in via the mutators below; the grid and other consumers read
 * it through `useLogsContent`.
 */
export interface LogsContent {
  handles: LogHandle[];
  previews: Record<string, LogPreview>;
  details: Record<string, LogDetails>;
}

const EMPTY: LogsContent = { handles: [], previews: {}, details: {} };

export const logsContentKey = (logDir: string | undefined) =>
  ["logs-content", logDir ?? ""] as const;

const current = (logDir: string | undefined): LogsContent =>
  queryClient.getQueryData<LogsContent>(logsContentKey(logDir)) ?? EMPTY;

/** Read the current content snapshot (for non-React call sites). */
export const getLogsContent = (logDir: string | undefined): LogsContent =>
  current(logDir);

export const setLogHandles = (
  logDir: string | undefined,
  handles: LogHandle[]
): void => {
  queryClient.setQueryData<LogsContent>(logsContentKey(logDir), (prev) => ({
    ...(prev ?? EMPTY),
    handles,
  }));
};

export const mergeLogPreviews = (
  logDir: string | undefined,
  previews: Record<string, LogPreview>
): void => {
  queryClient.setQueryData<LogsContent>(logsContentKey(logDir), (prev) => ({
    ...(prev ?? EMPTY),
    previews: { ...(prev ?? EMPTY).previews, ...previews },
  }));
};

export const mergeLogDetails = (
  logDir: string | undefined,
  details: Record<string, LogDetails>
): void => {
  queryClient.setQueryData<LogsContent>(logsContentKey(logDir), (prev) => ({
    ...(prev ?? EMPTY),
    details: { ...(prev ?? EMPTY).details, ...details },
  }));
};

/**
 * Subscribe to the log content for a directory. The query is a passive cache
 * container — the replication sync drives updates via `setQueryData`, and
 * subscribers re-render on those writes. `staleTime: Infinity` because the sync
 * (not react-query) owns freshness.
 */
export const useLogsContent = (logDir: string | undefined): LogsContent => {
  const { data } = useQuery({
    queryKey: logsContentKey(logDir),
    queryFn: () => current(logDir),
    staleTime: Infinity,
  });
  return data ?? EMPTY;
};

export const useLogHandles = (logDir: string | undefined): LogHandle[] =>
  useLogsContent(logDir).handles;

export const useLogPreviews = (
  logDir: string | undefined
): Record<string, LogPreview> => useLogsContent(logDir).previews;

export const useLogDetails = (
  logDir: string | undefined
): Record<string, LogDetails> => useLogsContent(logDir).details;
