import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PulsingDots } from "./PulsingDots";

describe("PulsingDots", () => {
  it("renders with role='status' for accessibility", () => {
    const { getByRole } = render(<PulsingDots />);
    expect(getByRole("status")).toBeInTheDocument();
  });

  it("renders 3 dots by default", () => {
    const { getAllByTestId } = render(<PulsingDots />);
    expect(getAllByTestId("pulsing-dot")).toHaveLength(3);
  });

  it("renders custom dot count", () => {
    const { getAllByTestId } = render(<PulsingDots dotsCount={5} />);
    expect(getAllByTestId("pulsing-dot")).toHaveLength(5);
  });

  it("includes accessible text (screen-reader only by default)", () => {
    const { getByText } = render(<PulsingDots text="Fetching data..." />);
    expect(getByText("Fetching data...")).toBeInTheDocument();
  });

  it("renders visible text when showText is true", () => {
    const { getByText } = render(
      <PulsingDots text="Loading..." showText={true} />
    );
    expect(getByText("Loading...")).toBeInTheDocument();
  });

  it("does not render sr-text span when showText is true", () => {
    const { queryByTestId } = render(<PulsingDots showText={true} />);
    expect(queryByTestId("sr-text")).not.toBeInTheDocument();
  });
});
