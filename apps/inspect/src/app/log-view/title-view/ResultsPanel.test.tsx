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

const scoreSummary = (
  scorer: string,
  metricNames: string[],
  headlineIndex?: number
): ScoreSummary => ({
  scorer,
  scoredSamples: 2,
  unscoredSamples: 0,
  metrics: metricNames.map((name, i) => ({
    name,
    value: (i + 1) / 10,
    headline: i === headlineIndex,
  })),
});

const score = (scorer: string, metricCount: number, headlineIndex?: number) =>
  scoreSummary(
    scorer,
    Array.from({ length: metricCount }, (_, i) => `metric_${i + 1}`),
    headlineIndex
  );

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

const renderPanel = (scorers: ScoreSummary[], headlineDeclared?: boolean) =>
  render(
    <ResultsPanel scorers={scorers} headlineDeclared={headlineDeclared} />,
    { wrapper: Wrapper }
  );

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

  test("a single scorer's column cap keeps a headline metric beyond it", () => {
    // metric_7 is the headline: it leads, and the cap drops later columns
    renderPanel([score("scorer_1", 8, 6)]);

    expect(screen.getByText("metric_7")).toBeInTheDocument();
    expect(screen.getByText("metric_1")).toBeInTheDocument();
    expect(screen.queryByText("metric_5")).not.toBeInTheDocument();
  });

  test("the grid's column cap keeps a headline metric beyond it", () => {
    renderPanel([score("scorer_1", 8, 6), score("scorer_2", 8)], true);

    expect(
      screen.getByRole("columnheader", { name: "metric_7" })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("columnheader", { name: "metric_5" })
    ).not.toBeInTheDocument();
  });

  test("a grouped headline fronted by the cap keeps its group header", () => {
    const groupedScore = (scorer: string, headline: boolean): ScoreSummary => ({
      ...score(scorer, 5),
      metrics: [
        ...score(scorer, 5).metrics,
        { name: "yes", value: 0.6, group: "frequency" },
        { name: "no", value: 0.7, group: "frequency", headline },
      ],
    });
    renderPanel([groupedScore("scorer_1", true), groupedScore("scorer_2", false)], true);

    // the whole "frequency" run leads (headline first within it), so the
    // sub-metric names keep the group header that gives them meaning
    expect(
      screen.getByRole("columnheader", { name: "frequency" })
    ).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "no" })).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "yes" })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("columnheader", { name: "metric_4" })
    ).not.toBeInTheDocument();
  });
});

// four scorers share a metric signature and so group together; the fifth has
// its own signature and is the only group that fits kMaxPrimaryScoreRows
const oversizedFirstGroup = (headline: boolean): ScoreSummary[] => [
  ...["a", "b", "c", "d"].map((s, i) =>
    scoreSummary(s, ["accuracy", "stderr"], headline && i === 0 ? 0 : undefined)
  ),
  scoreSummary("solo", ["bleu"]),
];

describe("ResultsPanel primary group selection", () => {
  afterEach(cleanup);

  test("prefers a group that fits when the headline was not declared", () => {
    renderPanel(oversizedFirstGroup(true));
    // the headline mark is conventional here, so it must not pin an oversized
    // group the way a declared one does
    expect(screen.getByText("solo")).toBeInTheDocument();
    expect(screen.queryByText("a")).not.toBeInTheDocument();
  });

  test("keeps the declared headline's group even when oversized", () => {
    renderPanel(oversizedFirstGroup(true), true);
    expect(screen.getByText("a")).toBeInTheDocument();
    expect(screen.queryByText("solo")).not.toBeInTheDocument();
  });
});
