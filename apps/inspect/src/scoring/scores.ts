import { leadWith } from "./headline";
import { MetricSummary, ScoreSummary } from "./types";

export interface MetricGroupRun {
  group?: string | null;
  metrics: MetricSummary[];
}

/**
 * Partition metrics into runs of consecutive entries sharing the same
 * `group`. Used to render grouped column headers for dict-returning metrics
 * (e.g. one "frequency" header spanning per-category sub-columns).
 */
export const groupMetricRuns = (metrics: MetricSummary[]): MetricGroupRun[] => {
  const runs: MetricGroupRun[] = [];
  for (const m of metrics) {
    const last = runs[runs.length - 1];
    if (last && (last.group ?? null) === (m.group ?? null)) {
      last.metrics.push(m);
    } else {
      runs.push({ group: m.group, metrics: [m] });
    }
  }
  return runs;
};

export const isGroupRun = (r: MetricGroupRun): boolean =>
  r.group != null && r.metrics.length > 1;

/**
 * Reorder metrics so the one at `headline` leads, without orphaning it from
 * a dict-metric group run: fronting a grouped metric alone would strip it of
 * the group header that gives its sub-metric name meaning, so its whole run
 * moves to the front (headline leading within it) and stays contiguous. An
 * ungrouped headline moves alone. Out-of-range or already-first is a no-op.
 */
export const leadWithMetricColumn = (
  metrics: MetricSummary[],
  headline: number
): MetricSummary[] => {
  const target = metrics[headline];
  if (headline <= 0 || !target) {
    return metrics;
  }
  if (target.group == null) {
    return leadWith(metrics, headline);
  }
  let start = headline;
  while (start > 0 && metrics[start - 1]?.group === target.group) {
    start--;
  }
  let end = headline;
  while (end + 1 < metrics.length && metrics[end + 1]?.group === target.group) {
    end++;
  }
  const run = leadWith(metrics.slice(start, end + 1), headline - start);
  return [...run, ...metrics.slice(0, start), ...metrics.slice(end + 1)];
};

export const groupScorers = (scorers: ScoreSummary[]): ScoreSummary[][] => {
  const results: Record<string, ScoreSummary[]> = {};
  scorers.forEach((scorer) => {
    if (scorer.metrics.length > 0) {
      const key = metricsKey(scorer.metrics);
      results[key] = results[key] || [];

      results[key].push(scorer);
    }
  });
  return Object.values(results);
};

const metricsKey = (metrics: MetricSummary[]): string => {
  return metrics.map((m) => `${m.group ?? ""}::${m.name}`).join("|");
};
