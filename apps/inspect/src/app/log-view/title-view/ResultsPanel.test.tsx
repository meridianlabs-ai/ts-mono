// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { ReactNode } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  ComponentIconProvider,
  ComponentIcons,
} from "@tsmono/react/components";

import { ScoreSummary } from "../../../scoring/types";

import { ResultsPanel } from "./ResultsPanel";

vi.mock("@tsmono/react/hooks", () => ({
  useProperty: () => [false, () => {}],
}));

const icons: ComponentIcons = {
  arrowDown: "",
  arrowUp: "",
  chevronDown: "",
  chevronUp: "",
  clearText: "",
  close: "",
  code: "",
  confirm: "",
  copy: "",
  error: "",
  menu: "",
  next: "",
  noSamples: "",
  play: "",
  previous: "",
  toggleRight: "",
};

const renderPanel = (children: ReactNode) =>
  render(
    <ComponentIconProvider icons={icons}>{children}</ComponentIconProvider>
  );

const scoreSummary = (
  scorer: string,
  metrics: string[],
  headline = false
): ScoreSummary => ({
  scorer,
  metrics: metrics.map((name, i) => ({
    name,
    value: i / 10,
    headline: headline && i === 0,
  })),
});

// four scorers share a metric signature and so group together; the fifth has
// its own signature and is the only group that fits kMaxPrimaryScoreRows
const oversizedFirstGroup = (headline: boolean): ScoreSummary[] => [
  ...["a", "b", "c", "d"].map((s, i) =>
    scoreSummary(s, ["accuracy", "stderr"], headline && i === 0)
  ),
  scoreSummary("solo", ["bleu"]),
];

describe("ResultsPanel primary group selection", () => {
  // Auto-cleanup needs vitest `globals: true`, which this config doesn't set.
  afterEach(cleanup);

  test("prefers a group that fits when the headline was not declared", () => {
    renderPanel(<ResultsPanel scorers={oversizedFirstGroup(true)} />);
    // the headline mark is conventional here, so it must not pin an oversized
    // group the way a declared one does
    expect(screen.getByText("solo")).toBeInTheDocument();
    expect(screen.queryByText("a")).not.toBeInTheDocument();
  });

  test("keeps the declared headline's group even when oversized", () => {
    renderPanel(
      <ResultsPanel scorers={oversizedFirstGroup(true)} headlineDeclared />
    );
    expect(screen.getByText("a")).toBeInTheDocument();
    expect(screen.queryByText("solo")).not.toBeInTheDocument();
  });
});
