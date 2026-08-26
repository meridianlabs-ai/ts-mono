import { EvalScores } from "../@types/extraInspect";

import { ResolvedHeadlineMetric } from "./headline";
import { MetricSummary, ScoreSummary } from "./types";

export const metricDisplayName = (metric: MetricSummary): string => {
  let modifier = undefined;
  for (const metricModifier of metricModifiers) {
    modifier = metricModifier(metric);
    if (modifier) {
      break;
    }
  }
  const metricName = !modifier ? metric.name : `${metric.name}[${modifier}]`;

  return metricName;
};

type MetricModifier = (metric: MetricSummary) => string | undefined;

const clusterMetricModifier: MetricModifier = (
  metric: MetricSummary
): string | undefined => {
  if (metric.name !== "stderr") {
    return undefined;
  }

  const clusterValue = metric.params?.["cluster"];
  if (clusterValue === undefined || typeof clusterValue !== "string") {
    return undefined;
  }
  return clusterValue;
};

const groupMetricModifier: MetricModifier = (metric: MetricSummary) => {
  const groupKey = metric.params?.["group_key"];
  if (groupKey === undefined || typeof groupKey !== "string") {
    return undefined;
  }
  const metricRaw = metric.params?.["metric"];
  if (metricRaw === undefined || typeof metricRaw !== "object") {
    return undefined;
  }
  const metricObj = metricRaw as Record<string, unknown>;
  const name = metricObj["name"] as string;
  return name;
};

const metricModifiers: MetricModifier[] = [
  clusterMetricModifier,
  groupMetricModifier,
];

/**
 * Display rows for a log's scores, with the headline marked.
 *
 * `headline` must have been resolved from the same `scores` — the mark is by
 * object identity, since two scores can be alike in every field a headline
 * reference names.
 */
export const toDisplayScorers = (
  scores?: EvalScores,
  headline?: ResolvedHeadlineMetric
): ScoreSummary[] => {
  if (!scores) {
    return [];
  }

  return scores.map((score) => {
    // mark the headline here, where the score's full identity is still
    // available; expansion and grouping downstream drop what it matches on
    const isHeadline = headline !== undefined && score === headline.score;
    return {
      scorer: score.name,
      scorerName: score.scorer,
      reducer: score.reducer === null ? undefined : score.reducer,
      metrics: Object.entries(score.metrics).map(([metricKey, metric]) => {
        return {
          name: metric.name,
          metricKey,
          group: metric.group,
          value: metric.value,
          params: metric.params,
          headline: isHeadline && metricKey === headline.name,
        };
      }),
      unscoredSamples:
        score.unscored_samples !== null ? score.unscored_samples : undefined,
      scoredSamples:
        score.scored_samples !== null ? score.scored_samples : undefined,
    };
  });
};

const isGroupedMetric = (metric: MetricSummary): boolean => {
  if (!metric.params) {
    return false;
  }
  const params = metric.params;
  return params["group_key"] !== undefined && params["metric"] !== undefined;
};

const getBaseMetricName = (metric: MetricSummary): string | undefined => {
  if (!metric.params) {
    return undefined;
  }
  const params = metric.params;
  const metricObj = params["metric"] as Record<string, unknown> | undefined;
  if (!metricObj || typeof metricObj !== "object") {
    return undefined;
  }
  return metricObj["name"] as string;
};

const normalizeMetricName = (name: string): string => {
  return name.replace(/\d+$/, "");
};

export const expandGroupedMetrics = (
  scorers: ScoreSummary[]
): ScoreSummary[] => {
  const result: ScoreSummary[] = [];

  for (const scorer of scorers) {
    if (scorer.metrics.length === 0) {
      result.push(scorer);
      continue;
    }

    const hasGroupedMetrics = scorer.metrics.some(isGroupedMetric);

    if (!hasGroupedMetrics) {
      result.push(scorer);
      continue;
    }

    const metricsByBase = new Map<string, MetricSummary[]>();
    const nonGroupedMetrics: MetricSummary[] = [];

    for (const metric of scorer.metrics) {
      const baseMetricName = getBaseMetricName(metric);
      if (!baseMetricName) {
        nonGroupedMetrics.push(metric);
        continue;
      }

      if (!metricsByBase.has(baseMetricName)) {
        metricsByBase.set(baseMetricName, []);
      }
      metricsByBase.get(baseMetricName)!.push({
        ...metric,
        name: normalizeMetricName(metric.name),
      });
    }

    if (nonGroupedMetrics.length > 0) {
      result.push({
        scorer: scorer.scorer,
        scorerName: scorer.scorerName,
        reducer: scorer.reducer,
        metrics: nonGroupedMetrics,
        unscoredSamples: scorer.unscoredSamples,
        scoredSamples: scorer.scoredSamples,
      });
    }

    for (const [baseMetricName, metrics] of metricsByBase.entries()) {
      result.push({
        scorer: scorer.scorer,
        scorerName: scorer.scorerName,
        reducer: baseMetricName,
        metrics: metrics,
        unscoredSamples: scorer.unscoredSamples,
        scoredSamples: scorer.scoredSamples,
      });
    }
  }

  return result;
};
