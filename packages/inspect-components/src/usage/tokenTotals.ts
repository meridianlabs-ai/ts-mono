import type { ModelUsageData } from "./ModelUsagePanel";

const inputAll = (usage: ModelUsageData): number =>
  (usage.input_tokens ?? 0) +
  (usage.input_tokens_cache_read ?? 0) +
  (usage.input_tokens_cache_write ?? 0);

/** Output tokens excluding reasoning, so a composition that shows reasoning
 *  as its own category counts it once. Providers include reasoning in
 *  output_tokens; older Grok and Gemini logs reported it separately, which
 *  shows as input + output + reasoning adding up to the recorded total. Logs
 *  from before inspect_ai split cached reads out of input_tokens (Feb 2026)
 *  count the cache inside input, so both input sums are checked. A record
 *  whose categories add up to the total with reasoning inside output is
 *  current-shape and checked first. It is ambiguous only when cached tokens
 *  equal reasoning, output is at least reasoning and input is at least the
 *  cached reads: then it also fits the older cache-in-input shape, and the
 *  current shape wins. An aggregate mixing both shapes, or a total with
 *  tokens outside every category (Gemini tool-use prompts), can't be told
 *  apart either and is treated as inclusive. */
export const visibleOutputTokens = (usage: ModelUsageData): number => {
  const output = usage.output_tokens ?? 0;
  const reasoning = usage.reasoning_tokens ?? 0;
  if (reasoning <= 0) return output;
  const total = usage.total_tokens ?? 0;
  const inclusive =
    total > 0 && output >= reasoning && inputAll(usage) + output === total;
  if (inclusive) return output - reasoning;
  const separateFrom = (input: number) =>
    total > 0 && input + output + reasoning === total;
  const separate =
    separateFrom(inputAll(usage)) || separateFrom(usage.input_tokens ?? 0);
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
