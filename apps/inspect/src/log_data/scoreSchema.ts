import { useCallback } from "react";

import { useMapAsyncData } from "@tsmono/react/hooks";
import { AsyncData } from "@tsmono/util";

import { useStableValue } from "../app/shared/useStableValue";
import { Log } from "../client/api/types";

import { useLogs } from "./logsContent";

/**
 * Scorer/metric column discovery — the answer to "which score columns does
 * this scope offer", derived from the logs' results. That it is computed
 * from row content this subsystem holds (not from any particular payload)
 * is private; consumers get a content-stable map.
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
 * @param logs - The directory's Log rows
 * @param scopePrefix - When set, only logs whose name starts with this
 *   prefix contribute (folder view scoping)
 */
export function computeScorerMap(logs: Log[], scopePrefix?: string): ScorerMap {
  const info: ScorerMap = {};

  for (const log of logs) {
    if (scopePrefix && !log.name.startsWith(scopePrefix)) {
      continue;
    }
    if (log.header?.results?.scores) {
      for (const evalScore of log.header.results.scores) {
        for (const [metricName, metric] of Object.entries(evalScore.metrics)) {
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

/**
 * The score columns available in a scope. Row content gets a new identity
 * on every detail flush while a directory loads, but the scorer
 * columns it implies almost never change — the result is content-stabilized
 * so consumers (and the column defs keyed on it) keep a stable reference
 * across flushes.
 */
const asyncScorerMapsEqual = (
  a: AsyncData<ScorerMap>,
  b: AsyncData<ScorerMap>
): boolean =>
  a.loading === b.loading &&
  a.error === b.error &&
  (a.data !== undefined && b.data !== undefined
    ? scorerMapsEqual(a.data, b.data)
    : a.data === b.data);

export const useScoreSchema = (
  logDir: string,
  scopePrefix?: string
): AsyncData<ScorerMap> => {
  const logs = useLogs(logDir);
  return useStableValue(
    useMapAsyncData(
      logs,
      useCallback(
        (rows: Log[]) => computeScorerMap(rows, scopePrefix),
        [scopePrefix]
      )
    ),
    asyncScorerMapsEqual
  );
};
