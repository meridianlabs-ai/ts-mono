import { describe, expect, it } from "vitest";

import type { ModelUsageData } from "./ModelUsagePanel";
import { compositionTotal, visibleOutputTokens } from "./tokenTotals";

const usage = (u: Partial<ModelUsageData>): ModelUsageData => ({
  input_tokens: 0,
  output_tokens: 0,
  total_tokens: 0,
  ...u,
});

describe("visibleOutputTokens and compositionTotal", () => {
  it.each([
    // [case, usage, visible output, composition]
    [
      "older Grok log: reasoning reported outside output",
      usage({
        input_tokens: 32,
        output_tokens: 9,
        reasoning_tokens: 94,
        total_tokens: 135,
      }),
      9,
      135,
    ],
    [
      "current Grok log: reasoning folded into output",
      usage({
        input_tokens: 32,
        output_tokens: 103,
        reasoning_tokens: 94,
        total_tokens: 135,
      }),
      9,
      135,
    ],
    [
      "Anthropic/Google: output includes reasoning",
      usage({
        input_tokens: 50,
        output_tokens: 200,
        reasoning_tokens: 150,
        total_tokens: 250,
      }),
      50,
      250,
    ],
    [
      "Gemini with tool-use prompt tokens: total exceeds the categories",
      usage({
        input_tokens: 50,
        output_tokens: 200,
        reasoning_tokens: 150,
        total_tokens: 280,
      }),
      50,
      250,
    ],
    [
      "OpenAI: input already includes cached reads",
      usage({
        input_tokens: 100,
        input_tokens_cache_read: 60,
        output_tokens: 80,
        reasoning_tokens: 30,
        total_tokens: 180,
      }),
      50,
      240,
    ],
    [
      "no total recorded",
      usage({
        input_tokens: 10,
        output_tokens: 40,
        reasoning_tokens: 25,
        total_tokens: 0,
      }),
      15,
      50,
    ],
    [
      "reasoning larger than output: clamped at zero",
      usage({
        input_tokens: 10,
        output_tokens: 5,
        reasoning_tokens: 8,
        total_tokens: 15,
      }),
      0,
      18,
    ],
    [
      "older Grok log with a cached prompt",
      usage({
        input_tokens: 12,
        input_tokens_cache_read: 20,
        output_tokens: 9,
        reasoning_tokens: 94,
        total_tokens: 135,
      }),
      9,
      135,
    ],
    [
      "cache writes count toward the input side",
      usage({
        input_tokens: 40,
        input_tokens_cache_write: 10,
        output_tokens: 50,
        reasoning_tokens: 30,
        total_tokens: 100,
      }),
      20,
      100,
    ],
    [
      "no reasoning",
      usage({ input_tokens: 10, output_tokens: 5, total_tokens: 15 }),
      5,
      15,
    ],
  ])("%s", (_case, u, visible, composition) => {
    expect(visibleOutputTokens(u)).toBe(visible);
    expect(compositionTotal(u)).toBe(composition);
  });
});

it("treats missing fields as zero", () => {
  const u: ModelUsageData = { input_tokens: 10, output_tokens: 7 };
  expect(visibleOutputTokens(u)).toBe(7);
  expect(compositionTotal(u)).toBe(17);
});
