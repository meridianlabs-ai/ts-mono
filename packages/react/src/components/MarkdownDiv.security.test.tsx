// @vitest-environment jsdom
import { render, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";

import { MarkdownDiv } from "./MarkdownDiv";
import { renderMarkdown } from "./markdownRendering";

describe("MarkdownDiv rendered HTML sanitization", () => {
  // Pay the one-time lazy import of markdown-it-mathjax3 up front; on slow CI
  // runners it exceeds waitFor's default timeout inside the first math test.
  beforeAll(async () => {
    await renderMarkdown("$x$", "full");
  });

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

  it.each(["_blank", "_BLANK", "_BlAnK"])(
    "adds opener protection to %s new-context links",
    async (target) => {
      const { container } = render(
        <MarkdownDiv
          markdown="safe"
          postProcess={() =>
            `<a href="https://example.com" target="${target}">external</a>`
          }
        />
      );

      await waitFor(() => {
        expect(container.querySelector("a")).not.toBeNull();
      });

      expect(container.querySelector("a")?.getAttribute("rel")).toBe(
        "noopener noreferrer"
      );
    }
  );

  it("replaces remote markdown images with external links", async () => {
    const { container } = render(
      <MarkdownDiv markdown="![pixel](https://example.com/pixel.png)" />
    );

    await waitFor(() => {
      expect(container.querySelector("a")).not.toBeNull();
    });

    const anchor = container.querySelector("a");
    expect(container.querySelector("img")).toBeNull();
    expect(anchor?.getAttribute("href")).toBe("https://example.com/pixel.png");
    expect(anchor?.getAttribute("target")).toBe("_blank");
    expect(anchor?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("renders validated inline data images from markdown", async () => {
    const dataImage =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ";
    const { container } = render(
      <MarkdownDiv markdown={`![pixel](${dataImage})`} />
    );

    await waitFor(() => {
      expect(container.querySelector("img")).not.toBeNull();
    });

    expect(container.querySelector("img")?.getAttribute("src")).toBe(dataImage);
    expect(container.querySelector("img")?.getAttribute("alt")).toBe("pixel");
  });

  it("strips unsafe hrefs while keeping validated post-processed images", async () => {
    const dataImage =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ";
    const dataLink =
      "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==";
    const { container } = render(
      <MarkdownDiv
        markdown="text"
        postProcess={(html) =>
          `${html}<img src="${dataImage}"><a href="${dataLink}">unsafe</a>`
        }
      />
    );

    await waitFor(() => {
      expect(container.querySelector("img")).not.toBeNull();
    });

    expect(container.querySelector("a")?.hasAttribute("href")).toBe(false);
  });

  it.each([
    ["remote https", "https://example.com/pixel.png"],
    ["protocol-relative", "//example.com/pixel.png"],
    ["svg", "data:image/svg+xml;base64,AAAA"],
    ["not base64", "data:image/png,AAAA"],
    // DOMPurify accepts any data: URI on an img, so the gate is the only thing
    // rejecting a non-image payload here.
    [
      "text/html payload",
      "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    ],
    ["javascript scheme", "javascript:alert(1)"],
    ["blob", "blob:https://example.com/id"],
    ["empty", ""],
    ["whitespace only", "   "],
    // These are not in DOMPurify's ATTR_WHITESPACE, so nothing downstream
    // removes them. `da<U+FEFF>ta:` is not a valid scheme, so a browser reads
    // the whole value as a relative path and fetches it — the traversal case
    // steers that to an arbitrary same-origin path.
    ["U+FEFF in scheme", "da﻿ta:image/png;base64,AAAA"],
    ["U+202F in scheme", "da ta:image/png;base64,AAAA"],
    ["U+007F in scheme", "data:image/png;base64,AAAA"],
    ["path traversal", "da﻿ta:image/png;base64,/../../../evil.png"],
  ])("removes img with %s src", async (_label, source) => {
    const { container } = render(
      <MarkdownDiv
        markdown="text"
        postProcess={(html) => `${html}<img src="${source}">`}
      />
    );

    await waitFor(() => {
      expect(container.textContent).toContain("text");
    });

    expect(container.querySelector("img")).toBeNull();
  });

  it("removes an img that has no src attribute at all", async () => {
    const { container } = render(
      <MarkdownDiv markdown="text" postProcess={(html) => `${html}<img>`} />
    );

    await waitFor(() => {
      expect(container.textContent).toContain("text");
    });

    expect(container.querySelector("img")).toBeNull();
  });

  it("renders an uppercase data scheme rather than a src-less placeholder", async () => {
    const { container } = render(
      <MarkdownDiv markdown="![x](DATA:IMAGE/PNG;BASE64,AAAA)" />
    );

    await waitFor(() => {
      expect(container.querySelector("img")).not.toBeNull();
    });

    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "data:IMAGE/PNG;BASE64,AAAA"
    );
  });

  it("keeps sanitizing siblings after removing an img", async () => {
    const { container } = render(
      <MarkdownDiv
        markdown="text"
        postProcess={(html) =>
          `${html}<img src="https://evil.example/a.png"><a href="javascript:alert(1)" onclick="alert(2)">x</a>`
        }
      />
    );

    await waitFor(() => {
      expect(container.textContent).toContain("text");
    });

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("a")?.hasAttribute("href")).toBe(false);
    expect(container.querySelector("a")?.hasAttribute("onclick")).toBe(false);
  });
});
