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
    render(<LoadingBar loading={false} />);

    expect(screen.getByRole("progressbar").childElementCount).toBe(0);
  });
});
