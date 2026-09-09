import { ModelUsageData } from "./ModelUsagePanel";

export interface CostSummary {
  /** Summed cost across rows that recorded one. */
  total: number;
  /** True when a row used tokens but recorded no cost (mock/local/unpriced
   *  models) — the total understates real spend and should be shown as a
   *  lower bound. */
  partial: boolean;
}

const tokenTotal = (usage: ModelUsageData): number =>
  usage.total_tokens ||
  (usage.input_tokens ?? 0) +
    (usage.input_tokens_cache_read ?? 0) +
    (usage.input_tokens_cache_write ?? 0) +
    (usage.output_tokens ?? 0) +
    (usage.reasoning_tokens ?? 0);

/** Sum recorded costs across a usage dict; undefined when nothing is priced
 *  (old logs and unpriced runs render no cost UI at all). */
export const costSummary = (
  usage: Record<string, ModelUsageData> | undefined
): CostSummary | undefined => {
  if (!usage) return undefined;
  let total = 0;
  let priced = false;
  let partial = false;
  for (const u of Object.values(usage)) {
    if (u.total_cost != null) {
      total += u.total_cost;
      priced = true;
    } else if (tokenTotal(u) > 0) {
      partial = true;
    }
  }
  return priced ? { total, partial } : undefined;
};
