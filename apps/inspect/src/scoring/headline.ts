import {
  EvalMetric,
  EvalResults,
  EvalScore,
  HeadlineMetric,
} from "@tsmono/inspect-common/types";

export interface ResolvedHeadlineMetric {
  score: EvalScore;
  name: string;
  metric: EvalMetric;
}

/**
 * The score and metric that best summarise an eval.
 *
 * Prefers `results.headline`, which scoring resolves and fully qualifies.
 * Logs that carry only the task's declaration — hand-authored, partially
 * migrated, or produced outside inspect — resolve it here instead, mirroring
 * the Python resolver: a set field narrows the candidate scores, an unset one
 * matches any. Failing both, the first metric of the first score.
 */
export const resolveHeadlineMetric = (
  results?: EvalResults | null,
  declared?: HeadlineMetric | null
): ResolvedHeadlineMetric | undefined => {
  const scores = results?.scores;
  if (!scores || scores.length === 0) {
    return undefined;
  }

  const headline = results.headline ?? declared;
  const resolved = headline ? matchDeclared(scores, headline) : undefined;
  return resolved ?? firstMetric(scores[0]);
};

const matchDeclared = (
  scores: EvalScore[],
  headline: HeadlineMetric
): ResolvedHeadlineMetric | undefined => {
  const candidates = scores.filter(
    (score) =>
      (headline.scorer == null || score.scorer === headline.scorer) &&
      (headline.score == null || score.name === headline.score) &&
      (headline.reducer == null || score.reducer === headline.reducer)
  );

  const name = headline.metric;
  // "" is a legal metric key, so test for absence rather than truthiness
  if (name == null) {
    return candidates.length > 0 ? firstMetric(candidates[0]) : undefined;
  }

  // the metric is part of the search, not a lookup afterwards: a scorer
  // combining plain and per-key metrics emits several scores of identical
  // identity, and only some of them carry the metric
  const score = candidates.find(
    (candidate) => candidate.metrics[name] !== undefined
  );
  const metric = score?.metrics[name];
  return score && metric ? { score, name, metric } : undefined;
};

const firstMetric = (score?: EvalScore): ResolvedHeadlineMetric | undefined => {
  if (!score) {
    return undefined;
  }
  const [name] = Object.keys(score.metrics);
  const metric = name !== undefined ? score.metrics[name] : undefined;
  return name !== undefined && metric ? { score, name, metric } : undefined;
};

export const headlineMetric = (
  results?: EvalResults | null,
  declared?: HeadlineMetric | null
): EvalMetric | undefined => resolveHeadlineMetric(results, declared)?.metric;

/** Move `index` to the front, leaving the relative order of the rest intact. */
export const leadWith = <T>(items: T[], index: number): T[] =>
  index <= 0
    ? items
    : [items[index] as T, ...items.filter((_, i) => i !== index)];
