// @vitest-environment jsdom
import { cleanup, render, within } from "@testing-library/react";
import { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";

import {
  ComponentIconProvider,
  ComponentNavigationProvider,
} from "@tsmono/react/components";
import { ComponentStateProvider } from "@tsmono/react/state";
import { makeStateHooks, testIcons } from "@tsmono/react/testing";

import { RenderedContent } from "./RenderedContent";

afterEach(() => {
  cleanup();
});

// The generic object fallback renders a MetaDataGrid, which needs the
// component providers.
const renderContent = (ui: ReactElement) =>
  render(
    <ComponentStateProvider hooks={makeStateHooks()}>
      <ComponentIconProvider icons={testIcons}>
        <ComponentNavigationProvider navigation={{ navigate: () => {} }}>
          {ui}
        </ComponentNavigationProvider>
      </ComponentIconProvider>
    </ComponentStateProvider>
  );

const renderWebSearch = (url: string) =>
  renderContent(
    <RenderedContent
      id="web-search"
      entry={{
        name: "web_search",
        value: { query: "q", results: [{ url, summary: "Summary" }] },
      }}
    />
  );

describe("RenderedContent web_search results", () => {
  it("links an absolute http(s) result URL in a new tab", () => {
    const { container } = renderWebSearch("https://example.test/a?b=1");

    const link = within(container).getByRole("link", {
      name: "https://example.test/a?b=1",
    });
    expect(link.getAttribute("href")).toBe("https://example.test/a?b=1");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it.each(["file:///etc/passwd", "javascript:alert(1)", "vscode://file/x"])(
    "renders %s as text, not a link",
    (url) => {
      const { container } = renderWebSearch(url);

      expect(container.querySelector("a")).toBeNull();
      expect(container.textContent).toContain(url);
      expect(container.textContent).toContain("Summary");
    }
  );
});

// Metadata objects come straight from the eval log, so a renderer keyed on
// a magic property name (`_model`, `_html`) or entry name (`web_search`)
// must verify the shape it renders before claiming the value.
describe("RenderedContent log-shaped objects", () => {
  it("renders an object-valued _model as data instead of throwing", () => {
    const { container } = renderContent(
      <RenderedContent
        id="note"
        entry={{ name: "note", value: { _html: 1, _model: { a: 1 } } }}
      />
    );

    // The model renderer's icon is absent; the record grid shows the keys.
    expect(container.querySelector("i")).toBeNull();
    expect(container.textContent).toContain("_model");
    expect(container.textContent).toContain("a");
  });

  it("renders a string _model with the model renderer", () => {
    const { container } = renderContent(
      <RenderedContent
        id="model"
        entry={{ name: "model", value: { _model: "gpt-4o" } }}
      />
    );

    expect(container.querySelector("i")).not.toBeNull();
    expect(container.textContent).toContain("gpt-4o");
  });

  it.each([
    ["an empty object", {}, ""],
    ["an object without results", { _html: 1 }, "_html"],
    ["results that are not records", { query: "q", results: ["x"] }, "x"],
    ["a non-array results", { query: "q", results: { url: "u" } }, "url"],
  ])(
    "renders a web_search entry holding %s as data instead of throwing",
    (_label, value, shownKey) => {
      const { container } = renderContent(
        <RenderedContent id="ws" entry={{ name: "web_search", value }} />
      );

      // The search renderer's icon and links are absent; the record grid
      // shows the data.
      expect(container.querySelector("i")).toBeNull();
      expect(container.querySelector("a")).toBeNull();
      expect(container.textContent).toContain(shownKey);
    }
  );

  it("renders a web_search result with null optional fields", () => {
    const { container } = renderContent(
      <RenderedContent
        id="ws"
        entry={{
          name: "web_search",
          value: {
            query: null,
            results: [{ url: "https://example.test/a", summary: null }],
          },
        }}
      />
    );

    expect(
      within(container).getByRole("link", { name: "https://example.test/a" })
    ).toBeTruthy();
  });

  it("renders a well-formed web_search result with the search renderer", () => {
    const { container } = renderWebSearch("https://example.test/a");

    expect(container.textContent).toContain("q");
    expect(
      within(container).getByRole("link", { name: "https://example.test/a" })
    ).toBeTruthy();
  });

  it("renders an object-valued _html as data instead of raw", () => {
    const { container } = renderContent(
      <RenderedContent
        id="html"
        entry={{ name: "html", value: { _html: { nested: "text" } } }}
      />
    );

    expect(container.textContent).toContain("nested");
    expect(container.textContent).toContain("text");
  });
});
