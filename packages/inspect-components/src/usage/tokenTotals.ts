import type { ModelUsageData } from "./ModelUsagePanel";

const inputAll = (usage: ModelUsageData): number =>
  (usage.input_tokens ?? 0) +
  (usage.input_tokens_cache_read ?? 0) +
  (usage.input_tokens_cache_write ?? 0);

/** Output tokens excluding reasoning, so a composition that shows reasoning
 *  as its own category counts it once. Providers include reasoning in
 *  output_tokens; older Grok logs reported it separately, which shows as
 *  input + output + reasoning adding up to the recorded total. An aggregate
 *  mixing both shapes can't be told apart and is treated as inclusive. */
export const visibleOutputTokens = (usage: ModelUsageData): number => {
  const output = usage.output_tokens ?? 0;
  const reasoning = usage.reasoning_tokens ?? 0;
  if (reasoning <= 0) return output;
  const total = usage.total_tokens ?? 0;
  const separate = total > 0 && inputAll(usage) + output + reasoning === total;
  return separate ? output : Math.max(output - reasoning, 0);
};

/** Sum of the individual token categories — the fallback when a record
 *  carries no total. */
export const compositionTotal = (usage: ModelUsageData): number =>
  inputAll(usage) + visibleOutputTokens(usage) + (usage.reasoning_tokens ?? 0);

/** One total for every token surface (Usage tab, Activity tab): prefer the
 *  recorded total_tokens — providers disagree on composition (OpenAI's
 *  input_tokens already includes cached reads, so summing categories
 *  double-counts) — falling back to the composition when absent/zero. */
export const usageTotal = (usage: ModelUsageData): number =>
  usage.total_tokens || compositionTotal(usage);
