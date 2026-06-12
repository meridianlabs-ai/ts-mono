import { LogDetails } from "../../../../client/api/types";

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
 * `reducer="mean"` (explicit). "/" is used as separator because ag-grid treats
 * "." in `field` as nested-object access.
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
 * @param logDetails - Details map keyed by log file name
 * @param scopePrefix - When set, only logs whose name starts with this
 *   prefix contribute (folder view scoping)
 */
export function computeScorerMap(
  logDetails: Record<string, LogDetails>,
  scopePrefix?: string
): ScorerMap {
  const info: ScorerMap = {};

  for (const [logName, details] of Object.entries(logDetails)) {
    if (scopePrefix && !logName.startsWith(scopePrefix)) {
      continue;
    }
    if (details.results?.scores) {
      for (const evalScore of details.results.scores) {
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

/**
 * Content equality for two scorer maps, independent of key order.
 *
 * `logDetails` gets a new store identity on every detail flush while a
 * directory is loading, but the set of scorer columns it implies almost
 * never changes. Comparing content lets callers keep a stable map (and
 * thus stable ag-grid column defs) across those flushes.
 */
export function scorerMapsEqual(a: ScorerMap, b: ScorerMap): boolean {
  if (a === b) return true;
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  for (const key of aKeys) {
    const av = a[key];
    const bv = b[key];
    if (
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
