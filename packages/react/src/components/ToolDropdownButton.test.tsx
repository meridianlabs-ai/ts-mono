// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ToolDropdownButton } from "./ToolDropdownButton";

afterEach(cleanup);

describe("ToolDropdownButton heading and footer", () => {
  it("renders the heading above the items and the footer action below a divider", () => {
    const onItem = vi.fn();
    const onFooter = vi.fn();
    render(
      <ToolDropdownButton
        label="Copy"
        heading="Selected events (2)"
        items={{ Markdown: onItem }}
        footer={{ label: "Clear selection", icon: "close", onClick: onFooter }}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    const heading = screen.getByText("Selected events (2)");
    const item = screen.getByRole("button", { name: "Markdown" });
    const footer = screen.getByRole("button", { name: "Clear selection" });
    expect(
      heading.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      item.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(screen.getByRole("separator")).toBeDefined();

    fireEvent.click(footer);
    expect(onFooter).toHaveBeenCalledOnce();
    // the menu closes after an action like any other item
    expect(screen.queryByRole("button", { name: "Markdown" })).toBeNull();
  });

  it("renders neither heading nor divider without the props", () => {
    render(<ToolDropdownButton label="Copy" items={{ UUID: () => {} }} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(screen.getByRole("button", { name: "UUID" })).toBeDefined();
    expect(screen.queryByRole("separator")).toBeNull();
  });

  it("marks the selected item of a rich item list", () => {
    const onPick = vi.fn();
    render(
      <ToolDropdownButton
        label="Agent"
        items={[
          { key: "a", label: "main", selected: true, onClick: vi.fn() },
          { key: "b", label: "test-runner", onClick: onPick },
        ]}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    expect(
      screen.getByRole("button", { name: "main" }).getAttribute("aria-current")
    ).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "test-runner" }));
    expect(onPick).toHaveBeenCalledOnce();
  });
});
