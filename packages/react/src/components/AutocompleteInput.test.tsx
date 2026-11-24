// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { AutocompleteInput } from "./AutocompleteInput";

afterEach(cleanup);

it("keeps inside clicks open and dismisses outside clicks after reopening", () => {
  const onChange = vi.fn();
  render(
    <AutocompleteInput
      id="fruit"
      value=""
      onChange={onChange}
      suggestions={["apple", "pear"]}
      allowBrowse
    />
  );
  const input = screen.getByRole("combobox");
  for (let cycle = 0; cycle < 2; cycle++) {
    fireEvent.click(screen.getByRole("button", { name: "Show all options" }));
    expect(input.getAttribute("aria-expanded")).toBe("true");
    fireEvent.mouseDown(input);
    expect(input.getAttribute("aria-expanded")).toBe("true");
    fireEvent.mouseDown(document.body);
    expect(input.getAttribute("aria-expanded")).toBe("false");
  }
  expect(onChange).not.toHaveBeenCalled();
});
