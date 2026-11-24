// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EventNavsPicker } from "./EventNavsPicker";

afterEach(cleanup);

function setup() {
  const select = vi.fn();
  render(
    <EventNavsPicker
      navs={[
        { id: "one", title: "First", target: "first" },
        { id: "two", title: "Second", target: "second" },
      ]}
      selectedNav="first"
      setSelectedNav={select}
    />
  );
  return { button: screen.getByRole("button", { name: "First" }), select };
}

describe("EventNavsPicker", () => {
  it("opens a listbox of every nav with the current one selected", () => {
    const { button } = setup();
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["First", "Second"]);
    expect(options.map((o) => o.getAttribute("aria-selected"))).toEqual([
      "true",
      "false",
    ]);
  });

  it("selects an option and closes the menu", () => {
    const { button, select } = setup();
    fireEvent.click(button);
    fireEvent.click(screen.getByRole("option", { name: "Second" }));
    expect(select).toHaveBeenCalledWith("second");
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
