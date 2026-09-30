// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ComponentIconProvider,
  ComponentNavigationProvider,
} from "@tsmono/react/components";
import { ComponentStateProvider } from "@tsmono/react/state";
import { makeStateHooks, testIcons } from "@tsmono/react/testing";

import { MetaDataGrid } from "./MetaDataGrid";

const renderGrid = (
  entries: Record<string, unknown>,
  options?: { copyButton?: boolean },
  cells?: ReadonlyMap<string, ReactNode>
) =>
  render(
    <ComponentStateProvider hooks={makeStateHooks()}>
      <ComponentIconProvider icons={testIcons}>
        <ComponentNavigationProvider navigation={{ navigate: () => {} }}>
          <MetaDataGrid
            id="test-grid"
            entries={entries}
            options={options}
            cells={cells}
          />
        </ComponentNavigationProvider>
      </ComponentIconProvider>
    </ComponentStateProvider>
  );

describe("MetaDataGrid copy button", () => {
  const writeText = vi.fn(() => Promise.resolve());

  beforeEach(() => {
    writeText.mockClear();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders no copy buttons by default", () => {
    renderGrid({ name: "value" });
    expect(screen.queryByRole("button", { name: /copy/i })).toBeNull();
  });

  it("copies string values verbatim", async () => {
    renderGrid({ name: "hello world" }, { copyButton: true });
    const button = screen.getByRole("button", { name: "Copy name" });
    fireEvent.click(button);
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("hello world");
    });
  });

  it("copies non-string scalars as strings", async () => {
    renderGrid({ count: 42 }, { copyButton: true });
    fireEvent.click(screen.getByRole("button", { name: "Copy count" }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("42");
    });
  });

  it("copies array values as pretty-printed JSON", async () => {
    renderGrid({ items: [1, 2] }, { copyButton: true });
    fireEvent.click(screen.getByRole("button", { name: "Copy items" }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(JSON.stringify([1, 2], null, 2));
    });
  });

  it("renders copy buttons in nested group rows", async () => {
    renderGrid({ group: { inner: "nested value" } }, { copyButton: true });
    fireEvent.click(screen.getByRole("button", { name: "Copy inner" }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("nested value");
    });
  });

  it("renders no copy button for application control cells", () => {
    renderGrid(
      { custom: "value" },
      { copyButton: true },
      new Map([["custom", <span key="custom">bespoke</span>]])
    );
    expect(screen.queryByRole("button", { name: /copy/i })).toBeNull();
  });
});

describe("MetaDataGrid log-authored escape-hatch keys", () => {
  it("renders _html/_model objects from log metadata as a nested record", () => {
    const { container } = renderGrid({
      note: { _html: 1, _model: { a: 1 } },
      web_search: { _html: 1 },
    });

    expect(container.textContent).toContain("note");
    expect(container.textContent).toContain("_model");
    expect(container.textContent).toContain("web_search");
  });

  it("renders application controls independently of the plain content policy", () => {
    const { container } = renderGrid(
      { tags: ["custom"] },
      undefined,
      new Map([
        [
          "tags",
          <span key="tags" data-testid="custom-tags">
            custom
          </span>,
        ],
      ])
    );

    expect(
      container.querySelector('[data-testid="custom-tags"]')
    ).not.toBeNull();
    expect(container.textContent).not.toContain("$$typeof");
  });
});
