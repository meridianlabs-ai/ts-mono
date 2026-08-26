// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  testEvalMetric,
  testEvalResults,
  testEvalScore,
  testEvalSpec,
} from "@tsmono/inspect-common/testing";

import { CollapsedTitleBar } from "./CollapsedTitleBar";

// The collapsed bar reads the folded config only to decide whether an errored
// run still shows metrics; a successful run shows them regardless. Stub it so
// rendering doesn't require the store and a QueryClientProvider.
vi.mock("../../../state/hooks", () => ({
  useEffectiveEvalConfig: () => undefined,
}));

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
  // Auto-cleanup needs vitest `globals: true`, which this config doesn't set.
  afterEach(cleanup);

  test("leads with the headline metric rather than the first score", () => {
    const { container } = render(
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
    const { container } = render(
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
