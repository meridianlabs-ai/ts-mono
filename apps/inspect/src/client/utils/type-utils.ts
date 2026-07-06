import { EvalMetric, EvalResults } from "@tsmono/inspect-common/types";

import { EvalHeader, LogDetails, LogHeader, LogPreview } from "../api/types";

/** Split a details payload into its stored header form: everything but the
 *  sample summaries, plus the sample facts derived from them. */
export const toLogHeader = (details: LogDetails): LogHeader => {
  const { sampleSummaries, ...header } = details;
  const limits = new Set<string>();
  let errorCount = 0;
  for (const sample of sampleSummaries) {
    if (sample.error) errorCount += 1;
    if (sample.limit) limits.add(sample.limit);
  }
  return {
    ...header,
    sampleCount: sampleSummaries.length,
    sampleErrorCount: errorCount,
    sampleLimits: [...limits].sort(),
  };
};

export const toLogPreview = (header: EvalHeader | LogDetails): LogPreview => {
  const model_roles = header.eval.model_roles
    ? Object.fromEntries(
        Object.entries(header.eval.model_roles).map(([role, cfg]) => [
          role,
          cfg.model,
        ])
      )
    : undefined;

  return {
    eval_id: header.eval.eval_id,
    run_id: header.eval.run_id,

    task: header.eval.task,
    task_id: header.eval.task_id,
    task_version: header.eval.task_version,

    version: header.version,
    status: header.status,
    error: header.error,

    model: header.eval.model,
    model_roles,

    started_at: header.stats?.started_at,
    completed_at: header.stats?.completed_at,

    primary_metric: primaryMetric(header.results),
  };
};

const primaryMetric = (
  evalResults?: EvalResults | null
): EvalMetric | undefined => {
  const firstScore = evalResults?.scores?.[0];
  if (firstScore) {
    const metrics = Object.values(firstScore.metrics);
    if (metrics.length > 0) {
      return metrics[0];
    }
  }
  return undefined;
};
