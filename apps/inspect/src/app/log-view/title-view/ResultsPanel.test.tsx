// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { ReactNode, useState } from "react";
import { afterEach, describe, expect, test } from "vitest";

import { ComponentIconProvider } from "@tsmono/react/components";
import { ComponentStateProvider } from "@tsmono/react/state";
import { makeReactiveStateHooks, testIcons } from "@tsmono/react/testing";

import { ScoreSummary } from "../../../scoring/types";

import { ResultsPanel } from "./ResultsPanel";

const metric = (index: number) => ({
  name: `metric_${index}`,
  value: index / 10,
});

const score = (scorer: string, metricCount: number): ScoreSummary => ({
  scorer,
  scoredSamples: 2,
  unscoredSamples: 0,
  metrics: Array.from({ length: metricCount }, (_, index) => metric(index + 1)),
});

const Wrapper = ({ children }: { children: ReactNode }) => {
  const [hooks] = useState(makeReactiveStateHooks);
  return (
    <ComponentStateProvider hooks={hooks}>
      <ComponentIconProvider icons={testIcons}>
        {children}
      </ComponentIconProvider>
    </ComponentStateProvider>
  );
};

const renderPanel = (scorers: ScoreSummary[]) =>
  render(<ResultsPanel scorers={scorers} />, { wrapper: Wrapper });

afterEach(cleanup);

describe("ResultsPanel", () => {
  test("limits a wide score table in the title and keeps every metric in the dialog", () => {
    renderPanel([
      score("scorer_1", 8),
      score("scorer_2", 8),
      score("scorer_3", 8),
      score("scorer_4", 8),
    ]);

    expect(
      screen.getByRole("columnheader", { name: "metric_5" })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("columnheader", { name: "metric_6" })
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "All scoring..." }));

    const dialog = screen.getByRole("dialog", { name: "Scoring Detail" });
    expect(
      within(dialog).getByRole("columnheader", { name: "metric_8" })
    ).toBeInTheDocument();
  });

  test("limits a single scorer's vertical metrics and exposes the remainder", () => {
    renderPanel([score("scorer_1", 8)]);

    expect(screen.getByText("metric_5")).toBeInTheDocument();
    expect(screen.queryByText("metric_6")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "All scoring..." }));

    const dialog = screen.getByRole("dialog", { name: "Scoring Detail" });
    expect(within(dialog).getByText("metric_8")).toBeInTheDocument();
  });
});
