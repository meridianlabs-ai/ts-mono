// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { GridLoadingOverlay } from "./GridLoadingOverlay";

describe("GridLoadingOverlay", () => {
  it("renders with role='status' for accessibility", () => {
    const { container } = render(<GridLoadingOverlay />);
    const el = container.querySelector("[role='status']");
    expect(el).not.toBeNull();
  });

  it("contains loading text for screen readers", () => {
    const { container } = render(<GridLoadingOverlay />);
    expect(container.textContent).toContain("Loading...");
  });
});
