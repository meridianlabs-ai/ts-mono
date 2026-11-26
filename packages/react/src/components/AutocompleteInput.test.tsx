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

it("selects the text when autoFocus is set", () => {
  render(
    <AutocompleteInput
      id="fruit"
      value="banana"
      onChange={() => {}}
      suggestions={[]}
      autoFocus
    />
  );
  const input = screen.getByRole<HTMLInputElement>("combobox");
  expect(input.selectionStart).toBe(0);
  expect(input.selectionEnd).toBe(6);
});

it("leaves the text unselected without autoFocus", () => {
  render(
    <AutocompleteInput
      id="fruit"
      value="banana"
      onChange={() => {}}
      suggestions={[]}
    />
  );
  const input = screen.getByRole<HTMLInputElement>("combobox");
  expect(input.selectionEnd).toBe(input.selectionStart);
});

it("scrolls each option highlighted by the arrow keys into view", () => {
  const scrolled: string[] = [];
  // jsdom doesn't implement scrollIntoView.
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this.textContent);
  };
  try {
    render(
      <AutocompleteInput
        id="fruit"
        value=""
        onChange={() => {}}
        suggestions={["apple", "pear", "plum"]}
        allowBrowse
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Show all options" }));
    const input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(scrolled).toEqual(["apple", "pear", "apple"]);
  } finally {
    Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  }
});
