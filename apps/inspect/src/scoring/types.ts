export interface MetricSummary {
  name: string;
  /** Key of this metric within `EvalScore.metrics`, which is what a headline
   * reference names. Differs from `name` for package-qualified metrics and for
   * metrics returning a dict or list. Absent for running metrics. */
  metricKey?: string;
  group?: string | null;
  params?: Record<string, unknown>;
  value: number;
  /** Whether this is the eval's headline metric. Marked where the originating
   * score is still known, since expansion and grouping drop that identity. */
  headline?: boolean;
}

export interface ScoreSummary {
  /** `EvalScore.name` — the score, which for a dict-valued scorer is one of
   * its value keys rather than the scorer's own name. */
  scorer: string;
  /** `EvalScore.scorer` — needed to tell apart two dict-valued scorers that
   * share a value key. Absent for running metrics. */
  scorerName?: string;
  reducer?: string;
  metrics: MetricSummary[];
  unscoredSamples?: number;
  scoredSamples?: number;
}
