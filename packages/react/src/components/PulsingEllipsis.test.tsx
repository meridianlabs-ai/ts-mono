import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PulsingEllipsis } from "./PulsingEllipsis";

describe("PulsingEllipsis", () => {
  it("renders with role='status'", () => {
    const { getByRole } = render(<PulsingEllipsis />);
    expect(getByRole("status")).toBeInTheDocument();
  });

  it("renders default text", () => {
    const { getByRole } = render(<PulsingEllipsis />);
    expect(getByRole("status")).toHaveTextContent("Loading");
  });

  it("renders custom text", () => {
    const { getByRole } = render(<PulsingEllipsis text="Generating" />);
    expect(getByRole("status")).toHaveTextContent("Generating");
  });

});
