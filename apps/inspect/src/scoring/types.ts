export interface MetricSummary {
  name: string;
  group?: string | null;
  params?: {};
  value: number;
}

export interface ScoreSummary {
  scorer: string;
  reducer?: string;
  metrics: MetricSummary[];
  unscoredSamples?: number;
  scoredSamples?: number;
}
