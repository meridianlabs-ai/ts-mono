// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PulsingDots } from "./PulsingDots";

describe("PulsingDots", () => {
  it("renders with role='status' for accessibility", () => {
    const { container } = render(<PulsingDots />);
    const el = container.querySelector("[role='status']");
    expect(el).not.toBeNull();
  });

  it("renders 3 dots by default", () => {
    const { container } = render(<PulsingDots />);
    const dotsContainer = container.querySelector("[class*='dotsContainer']");
    const dots = dotsContainer?.children;
    expect(dots?.length).toBe(3);
  });

  it("renders custom dot count", () => {
    const { container } = render(<PulsingDots dotsCount={5} />);
    const dotsContainer = container.querySelector("[class*='dotsContainer']");
    const dots = dotsContainer?.children;
    expect(dots?.length).toBe(5);
  });

  it("includes accessible text", () => {
    const { container } = render(<PulsingDots text="Fetching data..." />);
    expect(container.textContent).toContain("Fetching data...");
  });
});
