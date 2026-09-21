import { isRecord } from "@tsmono/util";

import type { ConnectionLimitChange, EvalStats } from "../types";

import { normalizeModelUsageMap } from "./summary";

export interface NormalizedEvalStats extends EvalStats {
  // Keep malformed history local to its consumers instead of failing the log load.
  connectionHistoryError?: string;
}

const normalizeConnectionHistory = (
  raw: unknown
): Pick<
  NormalizedEvalStats,
  "connection_limit_history" | "connectionHistoryError"
> => {
  if (raw === undefined || raw === null)
    return { connection_limit_history: [] };
  if (!Array.isArray(raw)) {
    return {
      connection_limit_history: [],
      connectionHistoryError: "Invalid connection history: expected an array.",
    };
  }
  const history: ConnectionLimitChange[] = [];
  for (const entry of raw) {
    if (
      !isRecord(entry) ||
      typeof entry["model"] !== "string" ||
      typeof entry["timestamp"] !== "number" ||
      typeof entry["old_limit"] !== "number" ||
      typeof entry["new_limit"] !== "number" ||
      (entry["reason"] !== "slow_start" &&
        entry["reason"] !== "steady_state_up" &&
        entry["reason"] !== "rate_limit" &&
        entry["reason"] !== "manual")
    ) {
      return {
        connection_limit_history: [],
        connectionHistoryError:
          "Invalid connection history: malformed connection limit change.",
      };
    }
    history.push({
      ...entry,
      model: entry["model"],
      timestamp: entry["timestamp"],
      old_limit: entry["old_limit"],
      new_limit: entry["new_limit"],
      reason: entry["reason"],
    });
  }
  return { connection_limit_history: history };
};

/** Normalize stats defaults and history shape; timestamps retain their numeric value. */
export const normalizeEvalStats = (
  raw: unknown
): NormalizedEvalStats | undefined => {
  if (!isRecord(raw)) return undefined;
  return {
    ...raw,
    started_at: typeof raw["started_at"] === "string" ? raw["started_at"] : "",
    completed_at:
      typeof raw["completed_at"] === "string" ? raw["completed_at"] : "",
    model_usage: normalizeModelUsageMap(raw["model_usage"]),
    role_usage: normalizeModelUsageMap(raw["role_usage"]),
    connectionHistoryError: undefined,
    ...normalizeConnectionHistory(raw["connection_limit_history"]),
  };
};
