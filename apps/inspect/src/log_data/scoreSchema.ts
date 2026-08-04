import { Log } from "../client/api/types";
import { scopePrefix } from "../client/database";

/**
 * Scorer/metric column discovery — the answer to "which score columns does
 * this scope offer", derived from the logs' results. The pure computation
 * lives here; `readLogsColumnFacts` (logsListingRead) runs it over a DB
 * scan and `useLogColumnFacts` (app/log-list) serves it content-stabilized.
 */

export interface ScorerMetricInfo {
  scorerName: string;
  metricName: string;
  valueType: string;
}

/** Unique (scorer, metric) pairs discovered across logs, keyed by
 *  `scorerMetricKey`. Drives which score columns the log list offers. */
export type ScorerMap = Record<string, ScorerMetricInfo>;

/**
 * Build a stable, unique column key for a (scorer, metric) pair. The reducer
 * is intentionally omitted so the same logical metric is one column regardless
 * of whether the log recorded `reducer=null` (default, silently mean) or
 * `reducer="mean"` (explicit). "/" is used as separator ("." meant
 * nested-object access to the original AG grid; the format persists in
 * stored views, so it stays).
 */
export const scorerMetricKey = (
  scorerName: string,
  metricName: string
): string => `${scorerName}/${metricName}`;

/**
 * Detect all unique (scorer, reducer, metric) combinations across all logs
 * from their results. Collapsing on metric name alone would merge distinct
 * scorers emitting the same metric (e.g. two "accuracy"s) into one column.
 *
 * @param logs - The directory's Log rows
 * @param scopeDir - When set, only logs under this directory contribute
 *   (folder view scoping)
 */
export function computeScorerMap(logs: Log[], scopeDir?: string): ScorerMap {
  const info: ScorerMap = {};
  const prefix = scopeDir ? scopePrefix(scopeDir) : undefined;

  for (const log of logs) {
    if (prefix && !log.name.startsWith(prefix)) {
      continue;
    }
    if (log.header?.results?.scores) {
      for (const evalScore of log.header.results.scores) {
        if (evalScore.metrics) {
          for (const [metricName, metric] of Object.entries(
            evalScore.metrics
          )) {
            const key = scorerMetricKey(evalScore.name, metricName);
            info[key] = {
              scorerName: evalScore.name,
              metricName,
              valueType: typeof metric.value,
            };
          }
        }
      }
    }
  }

  return info;
}

/** Content equality for two scorer maps, independent of key order. */
export function scorerMapsEqual(a: ScorerMap, b: ScorerMap): boolean {
  if (a === b) return true;
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  for (const key of aKeys) {
    const av = a[key];
    const bv = b[key];
    if (
      !av ||
      !bv ||
      av.scorerName !== bv.scorerName ||
      av.metricName !== bv.metricName ||
      av.valueType !== bv.valueType
    ) {
      return false;
    }
  }
  return true;
}
