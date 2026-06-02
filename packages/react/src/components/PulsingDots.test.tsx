import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PulsingDots } from "./PulsingDots";

describe("PulsingDots", () => {
  it("renders with role='status' for accessibility", () => {
    const { getByRole } = render(<PulsingDots />);
    expect(getByRole("status")).toBeInTheDocument();
  });

  it("renders 3 dots by default", () => {
    const { container } = render(<PulsingDots />);
    const dotsContainer = container.querySelector("[class*='dotsContainer']");
    expect(dotsContainer?.children).toHaveLength(3);
  });

  it("renders custom dot count", () => {
    const { container } = render(<PulsingDots dotsCount={5} />);
    const dotsContainer = container.querySelector("[class*='dotsContainer']");
    expect(dotsContainer?.children).toHaveLength(5);
  });

  it("includes accessible text", () => {
    const { getByText } = render(<PulsingDots text="Fetching data..." />);
    expect(getByText("Fetching data...")).toBeInTheDocument();
  });
});
