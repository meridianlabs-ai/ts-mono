// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { ThemeToggle } from "./ThemeToggle";

afterEach(cleanup);

it("closes on Escape and restores focus after reopening", () => {
  const { unmount } = render(
    <ThemeToggle value="system" isDark={false} onChange={() => {}} />
  );
  const button = screen.getByRole("button", { name: "Choose theme" });
  for (let cycle = 0; cycle < 2; cycle++) {
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(button);
  }
  const focus = vi.spyOn(button, "focus");
  fireEvent.keyDown(document, { key: "Escape" });
  expect(focus).not.toHaveBeenCalled();
  fireEvent.click(button);
  unmount();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(focus).not.toHaveBeenCalled();
  focus.mockRestore();
});
