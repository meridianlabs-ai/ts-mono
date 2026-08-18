// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { LoadingBar } from "./LoadingBar";

afterEach(cleanup);

describe("LoadingBar", () => {
  it("exposes loading as indeterminate progress", () => {
    render(<LoadingBar loading />);

    const progressbar = screen.getByRole("progressbar");
    expect(progressbar.hasAttribute("aria-valuenow")).toBe(false);
    expect(progressbar.childElementCount).toBe(1);
  });

  it("does not render the animation when idle", () => {
    const { container } = render(<LoadingBar loading={false} />);

    expect(screen.queryByRole("progressbar")).toBeNull();
    const progressbar = container.querySelector('[role="progressbar"]');
    expect(progressbar?.getAttribute("aria-hidden")).toBe("true");
    expect(progressbar?.childElementCount).toBe(0);
  });
});
