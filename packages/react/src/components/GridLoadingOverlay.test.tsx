import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { GridLoadingOverlay } from "./GridLoadingOverlay";

describe("GridLoadingOverlay", () => {
  it("renders with role='status' for accessibility", () => {
    const { getByRole } = render(<GridLoadingOverlay />);
    expect(getByRole("status")).toBeInTheDocument();
  });

  it("displays visible loading text", () => {
    const { getByText } = render(<GridLoadingOverlay />);
    expect(getByText("Loading...")).toBeInTheDocument();
  });
});
