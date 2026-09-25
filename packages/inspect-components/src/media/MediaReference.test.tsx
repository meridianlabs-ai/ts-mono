// @vitest-environment jsdom
import { render as renderUi, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TrustedContentWrapper } from "@tsmono/react/testing";

import { MediaReference } from "./MediaReference";

// These tests exercise the rich rendering path, which needs trusted content.
const render = (ui: Parameters<typeof renderUi>[0]) =>
  renderUi(ui, { wrapper: TrustedContentWrapper });

describe("MediaReference", () => {
  it("renders absolute HTTP URLs as external links", () => {
    render(<MediaReference source="https://example.com/image.png" />);

    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("https://example.com/image.png");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it.each([
    "/relative/image.png",
    "//example.com/image.png",
    "file:///tmp/image.png",
    "blob:https://example.com/id",
    "custom://asset/1",
  ])("renders %s as text", (source) => {
    const { container } = render(<MediaReference source={source} />);

    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("code")?.textContent).toBe(source);
  });

  it("abbreviates inline data", () => {
    const { container } = render(
      <MediaReference source="data:image/svg+xml;base64,PHN2Zz4=" />
    );

    expect(container.querySelector("code")?.textContent).toBe(
      "data:image/svg+xml;base64,..."
    );
  });
});
