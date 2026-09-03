import { describe, expect, it } from "vitest";

import { costSummary } from "./cost";
import type { ModelUsageData } from "./ModelUsagePanel";

const priced = (tokens: number, cost: number): ModelUsageData => ({
  total_tokens: tokens,
  total_cost: cost,
});

const unpriced = (tokens: number): ModelUsageData => ({
  total_tokens: tokens,
});

describe("costSummary", () => {
  it("returns undefined for missing or empty usage", () => {
    expect(costSummary(undefined)).toBeUndefined();
    expect(costSummary({})).toBeUndefined();
  });

  it("returns undefined when no row has a cost (old logs, unpriced runs)", () => {
    expect(costSummary({ "mockllm/model": unpriced(1000) })).toBeUndefined();
  });

  it("sums costs across models", () => {
    expect(
      costSummary({
        "anthropic/claude-sonnet-5": priced(1000, 1.25),
        "openai/gpt-5": priced(2000, 2.5),
      })
    ).toEqual({ total: 3.75, partial: false });
  });

  it("flags a partial total when a row has tokens but no cost", () => {
    expect(
      costSummary({
        "anthropic/claude-sonnet-5": priced(1000, 1.25),
        "mockllm/model": unpriced(500),
      })
    ).toEqual({ total: 1.25, partial: true });
  });

  it("ignores costless rows without token usage (config-only rows)", () => {
    expect(
      costSummary({
        "anthropic/claude-sonnet-5": priced(1000, 1.25),
        "mockllm/model": unpriced(0),
      })
    ).toEqual({ total: 1.25, partial: false });
  });

  it("counts composition tokens when total_tokens is absent", () => {
    expect(
      costSummary({
        "anthropic/claude-sonnet-5": priced(1000, 1.25),
        "mockllm/model": { input_tokens: 300, output_tokens: 200 },
      })
    ).toEqual({ total: 1.25, partial: true });
  });
});
