// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { testIcons } from "../test/test-icons";

import { ComponentIconProvider } from "./ComponentIconContext";
import { ToolDropdownButton } from "./ToolDropdownButton";

afterEach(cleanup);

describe("ToolDropdownButton heading and footer", () => {
  it("renders the heading above the items and the footer action below a divider", () => {
    const onItem = vi.fn();
    const onFooter = vi.fn();
    render(
      <ComponentIconProvider icons={testIcons}>
        <ToolDropdownButton
          label="Copy"
          heading="Selected events (2)"
          items={{ Markdown: onItem }}
          footer={{ label: "Clear selection", icon: "i-x", onClick: onFooter }}
        />
      </ComponentIconProvider>
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
    render(
      <ComponentIconProvider icons={testIcons}>
        <ToolDropdownButton label="Copy" items={{ UUID: () => {} }} />
      </ComponentIconProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(screen.getByRole("button", { name: "UUID" })).toBeDefined();
    expect(screen.queryByRole("separator")).toBeNull();
  });
});
