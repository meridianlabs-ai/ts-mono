// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { RetryTerminalAnchor } from "./RetryTerminalAnchor";

describe("RetryTerminalAnchor", () => {
  afterEach(() => cleanup());

  it("uses singular copy for a single retry", () => {
    render(<RetryTerminalAnchor retryCount={1} />);
    expect(screen.getByText(/after 1 retry —/)).toBeDefined();
    expect(screen.getByText("This run succeeded")).toBeDefined();
  });

  it("uses plural copy for multiple retries", () => {
    render(<RetryTerminalAnchor retryCount={3} />);
    expect(screen.getByText(/after 3 retries —/)).toBeDefined();
  });
});
