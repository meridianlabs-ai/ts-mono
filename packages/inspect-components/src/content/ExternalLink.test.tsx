// @vitest-environment jsdom
import { cleanup, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ExternalLink } from "./ExternalLink";

afterEach(() => {
  cleanup();
});

describe("ExternalLink", () => {
  it.each(["https://example.test/a?b=1", "http://example.test/"])(
    "links %s in a new tab with opener protection",
    (href) => {
      const { container } = render(
        <ExternalLink href={href} className="cls" title="tip">
          label
        </ExternalLink>
      );

      const link = within(container).getByRole("link", { name: "label" });
      expect(link.getAttribute("href")).toBe(href);
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
      expect(link.getAttribute("class")).toBe("cls");
      expect(link.getAttribute("title")).toBe("tip");
    }
  );

  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "blob:https://example.test/id",
    "vscode://file/etc/passwd",
    "ms-msdt:/id",
    "custom://asset/1",
    "mailto:someone@example.test",
    "/relative/path",
    "//example.test/protocol-relative",
    "https://",
    "not a url",
  ])("renders %s as inert text", (href) => {
    const { container } = render(
      <ExternalLink href={href} title="tip">
        label
      </ExternalLink>
    );

    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toBe("label");
    expect(container.querySelector("span")?.getAttribute("title")).toBe("tip");
  });
});
