import type { ModelUsageData } from "./ModelUsagePanel";

/** Sum of the individual token categories — the fallback when a record
 *  carries no total. */
export const compositionTotal = (usage: ModelUsageData): number =>
  (usage.input_tokens ?? 0) +
  (usage.input_tokens_cache_read ?? 0) +
  (usage.input_tokens_cache_write ?? 0) +
  (usage.output_tokens ?? 0) +
  (usage.reasoning_tokens ?? 0);

/** One total for every token surface (Usage tab, Activity tab): prefer the
 *  recorded total_tokens — providers disagree on composition (OpenAI's
 *  input_tokens already includes cached reads, so summing categories
 *  double-counts) — falling back to the composition when absent/zero. */
export const usageTotal = (usage: ModelUsageData): number =>
  usage.total_tokens || compositionTotal(usage);
