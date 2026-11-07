// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  testEvalMetric,
  testEvalResults,
  testEvalScore,
  testEvalSpec,
  testModelConfig,
} from "@tsmono/inspect-common/testing";

import { startTestApp, stopTestApp, TestApp } from "../../../test/testApp";

import { CollapsedTitleBar } from "./CollapsedTitleBar";

// The collapsed bar reads the selected log's folded config only to decide
// whether an errored run still shows metrics; a successful run shows them
// regardless. Render it in the app with no log selected.
const renderBar = (ui: ReactElement) =>
  render(<TestApp path="/logs">{ui}</TestApp>);

const scoreWith = (scorer: string, metric: string, value: number) =>
  testEvalScore({
    name: scorer,
    scorer,
    metrics: { [metric]: testEvalMetric({ name: metric, value }) },
  });

const renderedLabels = (container: HTMLElement) =>
  Array.from(container.querySelectorAll(".text-style-label")).map((el) =>
    el.textContent.trim()
  );

describe("CollapsedTitleBar", () => {
  beforeEach(() => {
    startTestApp();
  });
  // Auto-cleanup needs vitest `globals: true`, which this config doesn't set.
  afterEach(async () => {
    cleanup();
    await stopTestApp();
  });

  test("shows the primary model before parenthesized custom roles", () => {
    const { getByText } = renderBar(
      <CollapsedTitleBar
        evalSpec={testEvalSpec({
          model: "openai/gpt-6-astra",
          model_roles: {
            generator: testModelConfig({ model: "mockllm/generator" }),
            judge: testModelConfig({ model: "mockllm/judge" }),
          },
        })}
      />
    );
    const model = getByText(
      "openai/gpt-6-astra (generator: mockllm/generator; judge: mockllm/judge)"
    );
    expect(model.getAttribute("title")).toBe(
      "openai/gpt-6-astra (generator: mockllm/generator; judge: mockllm/judge)"
    );
  });

  test("leads with the headline metric rather than the first score", () => {
    const { container } = renderBar(
      <CollapsedTitleBar
        evalSpec={testEvalSpec()}
        status="success"
        evalResults={testEvalResults({
          scores: [
            scoreWith("sanity", "coverage", 0.1),
            scoreWith("main", "accuracy", 0.9),
          ],
          headline: {
            scorer: "main",
            score: "main",
            metric: "accuracy",
            reducer: null,
          },
        })}
      />
    );
    expect(renderedLabels(container)).toEqual(["accuracy", "coverage"]);
  });

  test("keeps score order when no headline is recorded", () => {
    const { container } = renderBar(
      <CollapsedTitleBar
        evalSpec={testEvalSpec()}
        status="success"
        evalResults={testEvalResults({
          scores: [
            scoreWith("sanity", "coverage", 0.1),
            scoreWith("main", "accuracy", 0.9),
          ],
        })}
      />
    );
    expect(renderedLabels(container)).toEqual(["coverage", "accuracy"]);
  });
});
