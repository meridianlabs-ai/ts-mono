import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { testEvalScore, testEvalSpec } from "@tsmono/inspect-common/testing";
import type { EvalScore } from "@tsmono/inspect-common/types";
import {
  ComponentIconProvider,
  ComponentNavigationProvider,
} from "@tsmono/react/components";
import { ComponentStateProvider } from "@tsmono/react/state";
import { makeStateHooks, testIcons } from "@tsmono/react/testing";

import { PlanDetailView } from "./PlanDetailView";

afterEach(cleanup);

const renderScores = (scores: EvalScore[]) =>
  render(
    <ComponentStateProvider hooks={makeStateHooks()}>
      <ComponentIconProvider icons={testIcons}>
        <ComponentNavigationProvider navigation={{ navigate: () => {} }}>
          <PlanDetailView evaluation={testEvalSpec()} scores={scores} />
        </ComponentNavigationProvider>
      </ComponentIconProvider>
    </ComponentStateProvider>
  );

describe("PlanDetailView scorers", () => {
  it("groups scores by scorer", () => {
    renderScores([
      testEvalScore({ scorer: "match", name: "accuracy" }),
      testEvalScore({ scorer: "match", name: "stderr" }),
      testEvalScore({ scorer: "model_graded", name: "accuracy" }),
    ]);
    expect(screen.getByText("Scorers")).toBeInTheDocument();
    expect(screen.getByText(/match/)).toBeInTheDocument();
    expect(screen.getByText(/model_graded/)).toBeInTheDocument();
  });

  // Scorer names come from the log header; one that is an Object.prototype
  // member must render as an ordinary group instead of throwing.
  it.each(["constructor", "__proto__", "toString", "hasOwnProperty"])(
    "renders a scorer named %s as an ordinary group",
    (scorer) => {
      renderScores([
        testEvalScore({ scorer, name: "accuracy" }),
        testEvalScore({ scorer, name: "stderr" }),
      ]);
      expect(screen.getByText("Scorer")).toBeInTheDocument();
      expect(screen.getByText(new RegExp(scorer))).toBeInTheDocument();
    }
  );
});
