// @vitest-environment jsdom
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MarkdownDiv } from "./MarkdownDiv";

describe("MarkdownDiv rendered HTML sanitization", () => {
  it("removes active SVG injected through MathJax href rendering", async () => {
    const payload = '$\\href{x"><animate onbegin=alert(1)>}{z}$';
    const { container } = render(<MarkdownDiv markdown={payload} />);

    await waitFor(() => {
      expect(container.querySelector("mjx-container")).not.toBeNull();
    });

    expect(container.querySelector('span[id^="mjx-"] > style')).not.toBeNull();
    expect(container.querySelector("animate")).toBeNull();
    expect(container.querySelector("[onbegin]")).toBeNull();
    expect(container.innerHTML).not.toContain("onbegin");
  });

  it("sanitizes HTML added by post-processing before insertion", async () => {
    const { container } = render(
      <MarkdownDiv
        markdown="safe"
        postProcess={() =>
          '<a href="javascript:alert(1)" onclick="alert(1)" style="background-image: url(javascript:alert(1)); color: red">unsafe</a>'
        }
      />
    );

    await waitFor(() => {
      expect(container.querySelector("a")).not.toBeNull();
    });

    const anchor = container.querySelector("a");
    expect(anchor?.hasAttribute("href")).toBe(false);
    expect(anchor?.hasAttribute("onclick")).toBe(false);
    expect(anchor?.getAttribute("style") || "").not.toContain("javascript");
    expect(container.innerHTML).not.toContain("javascript:");
  });

  it("allows data image URLs without allowing non-image data links", async () => {
    const dataImage =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ";
    const dataLink =
      "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==";
    const { container } = render(
      <MarkdownDiv
        markdown={`![pixel](${dataImage})`}
        postProcess={(html) => `${html}<a href="${dataLink}">unsafe</a>`}
      />
    );

    await waitFor(() => {
      expect(container.querySelector("img")).not.toBeNull();
      expect(container.querySelector("a")).not.toBeNull();
    });

    expect(container.querySelector("img")?.getAttribute("src")).toBe(dataImage);
    expect(container.querySelector("a")?.hasAttribute("href")).toBe(false);
  });
});
