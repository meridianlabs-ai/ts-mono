// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ModelTokenTable } from "./ModelTokenTable";
import type { ModelUsageData } from "./ModelUsagePanel";

afterEach(cleanup);

const usage = (overrides: ModelUsageData): ModelUsageData => ({
  input_tokens: 800,
  output_tokens: 200,
  total_tokens: 1000,
  ...overrides,
});

describe("ModelTokenTable cost display", () => {
  it("renders per-model cost when total_cost is recorded", () => {
    const { getByText } = render(
      <ModelTokenTable
        model_usage={{
          "anthropic/claude-sonnet-5": usage({ total_cost: 1.25 }),
        }}
      />
    );
    expect(getByText("$1.25")).toBeTruthy();
  });

  it("renders no cost when total_cost is absent (old logs)", () => {
    const { queryByText } = render(
      <ModelTokenTable model_usage={{ "mockllm/model": usage({}) }} />
    );
    expect(queryByText(/\$/)).toBeNull();
  });

  it("renders avg cost per sample alongside avg tokens", () => {
    const { getByText } = render(
      <ModelTokenTable
        model_usage={{
          "anthropic/claude-sonnet-5": usage({ total_cost: 1.25 }),
        }}
        samples={10}
      />
    );
    expect(getByText("$0.13")).toBeTruthy();
    expect(getByText("avg cost / sample")).toBeTruthy();
  });
});
