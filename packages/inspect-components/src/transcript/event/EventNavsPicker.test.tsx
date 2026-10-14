// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EventNavsPicker } from "./EventNavsPicker";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function setup() {
  const select = vi.fn();
  const view = render(
    <div data-testid="scroll-parent">
      <EventNavsPicker
        navs={[
          { id: "one", title: "First", target: "first" },
          { id: "two", title: "Second", target: "second" },
        ]}
        selectedNav="first"
        setSelectedNav={select}
      />
    </div>
  );
  const button = screen.getByRole("button", { name: "First" });
  let rect = new DOMRect(100, 20, 200, 30);
  const measure = vi
    .spyOn(button, "getBoundingClientRect")
    .mockImplementation(() => rect);
  return {
    view,
    button,
    select,
    measure,
    move: () => {
      rect = new DOMRect(150, 70, 250, 40);
    },
  };
}

describe("EventNavsPicker position tracking", () => {
  it("measures on opening and follows window resizing", () => {
    const { button, move } = setup();
    fireEvent.click(button);
    expect(screen.getByRole("listbox").style.top).toBe("50px");
    move();
    fireEvent(window, new Event("resize"));
    const menu = screen.getByRole("listbox");
    expect(menu.style.top).toBe("110px");
    expect(menu.style.right).toBe(`${window.innerWidth - 400}px`);
    expect(menu.style.minWidth).toBe("250px");
  });

  it("captures non-bubbling nested scroll events", () => {
    const { button, move } = setup();
    fireEvent.click(button);
    move();
    fireEvent(
      screen.getByTestId("scroll-parent"),
      new Event("scroll", { bubbles: false })
    );
    expect(screen.getByRole("listbox").style.top).toBe("110px");
  });

  it("stops measuring when closed and restores focus on Escape", () => {
    const { button, measure } = setup();
    fireEvent.click(button);
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(button);
    measure.mockClear();
    fireEvent(window, new Event("resize"));
    fireEvent(
      screen.getByTestId("scroll-parent"),
      new Event("scroll", { bubbles: false })
    );
    expect(measure).not.toHaveBeenCalled();
  });

  it("removes position listeners on unmount", () => {
    const { button, measure, view } = setup();
    fireEvent.click(button);
    view.unmount();
    measure.mockClear();
    fireEvent(window, new Event("resize"));
    fireEvent(document.body, new Event("scroll", { bubbles: false }));
    expect(measure).not.toHaveBeenCalled();
  });

  it("selects an option and closes the menu", () => {
    const { button, select } = setup();
    fireEvent.click(button);
    fireEvent.click(screen.getByRole("option", { name: "Second" }));
    expect(select).toHaveBeenCalledWith("second");
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
