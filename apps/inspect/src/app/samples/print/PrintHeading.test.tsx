import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { testEvalSpec } from "@tsmono/inspect-common/testing";

import { PrintHeading } from "./PrintHeading";

afterEach(cleanup);

describe("PrintHeading", () => {
  it("renders task and model metadata as literal text", () => {
    const task = '<img src=x onerror="window.__printXss=true">';
    const model = '<svg onload="window.__printXss=true"></svg>';
    const evalSpec = testEvalSpec({
      task,
      model,
      created: "2026-06-25T12:00:00Z",
    });

    const { container } = render(<PrintHeading evalSpec={evalSpec} />);

    expect(screen.getByText(task)).toBeInTheDocument();
    expect(screen.getByText(model)).toBeInTheDocument();
    expect(container.querySelector("img, svg, script")).toBeNull();
  });

  it("preserves fallback labels", () => {
    const evalSpec = testEvalSpec({
      task: "",
      model: "",
      created: "",
    });

    render(<PrintHeading evalSpec={evalSpec} />);

    expect(screen.getByText("Unknown Task")).toBeInTheDocument();
    expect(screen.getByText("Unknown Model")).toBeInTheDocument();
    expect(screen.getByText("Unknown Time")).toBeInTheDocument();
  });
});
