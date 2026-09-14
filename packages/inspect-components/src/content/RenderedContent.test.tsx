// @vitest-environment jsdom
import { cleanup, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { RenderedContent } from "./RenderedContent";

afterEach(() => {
  cleanup();
});

const renderWebSearch = (url: string) =>
  render(
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
