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

    expect(container.querySelector("style")).toBeNull();
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

  it("does not render data-image markdown or post-processed image tags", async () => {
    const dataImage =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ";
    const dataLink =
      "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==";
    const { container } = render(
      <MarkdownDiv
        markdown={`![pixel](${dataImage})`}
        postProcess={(html) =>
          `${html}<img src="${dataImage}"><a href="${dataLink}">unsafe</a>`
        }
      />
    );

    await waitFor(() => {
      expect(container.querySelector("a")).not.toBeNull();
    });

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("a")?.hasAttribute("href")).toBe(false);
  });

  it("does not let math break out of an attribute into real markup", async () => {
    const payload = `$\\href{x"><span id="mjx-aa"><style>#mjx-aa{}body{background-image:image-set('https://evil.example/b.png' 1x)}</style><b z="}{z}$`;
    const { container } = render(<MarkdownDiv markdown={payload} />);

    await waitFor(() => {
      expect(container.querySelector("mjx-container")).not.toBeNull();
    });

    // Count only injected styles: every math render emits one legitimate
    // MathJax stylesheet, so a bare querySelector("style") would pass here for
    // the wrong reason.
    const injected = Array.from(container.querySelectorAll("style")).filter(
      (s) => (s.textContent ?? "").includes("evil.example")
    );
    expect(injected).toHaveLength(0);
    expect(container.querySelector("a[href]")).toBeNull();
  });

  it.each(["table", "thead", "tbody", "tfoot", "tr", "td", "th"])(
    "removes the background attribute from %s",
    async (tag) => {
      const { container } = render(
        <MarkdownDiv
          markdown="text"
          postProcess={(html) =>
            `${html}<table><${tag} background="https://evil.example/x.png"></${tag}></table>`
          }
        />
      );

      await waitFor(() => {
        expect(container.textContent).toContain("text");
      });

      expect(container.querySelector("[background]")).toBeNull();
      expect(container.innerHTML).not.toContain("evil.example");
    }
  );

  it.each([
    ["entity encoded", "&#104;ttps://evil.example/x.png"],
    ["leading whitespace", "   https://evil.example/x.png"],
  ])("removes a background attribute written as %s", async (_label, value) => {
    const { container } = render(
      <MarkdownDiv
        markdown="text"
        postProcess={(html) => `${html}<table background="${value}"></table>`}
      />
    );

    await waitFor(() => {
      expect(container.textContent).toContain("text");
    });

    expect(container.querySelector("[background]")).toBeNull();
  });

  // Each element needs its real parent namespace: mglyph is MathML, and inside
  // <svg> it is dropped as unknown, which would pass for the wrong reason.
  it.each([
    ["mglyph", "math"],
    ["feimage", "svg"],
    ["animatecolor", "svg"],
  ])("removes the %s element", async (tag, parent) => {
    const { container } = render(
      <MarkdownDiv
        markdown="text"
        postProcess={(html) =>
          `${html}<${parent}><${tag} src="https://evil.example/x.png" href="https://evil.example/y.png"></${tag}></${parent}>`
        }
      />
    );

    await waitFor(() => {
      expect(container.textContent).toContain("text");
    });

    expect(container.querySelector(tag)).toBeNull();
    expect(container.innerHTML).not.toContain("evil.example");
  });

  it.each([
    "fill",
    "stroke",
    "mask",
    "filter",
    "clip-path",
    "marker-start",
    "marker-mid",
    "marker-end",
  ])("removes an external url() from the %s attribute", async (attr) => {
    const { container } = render(
      <MarkdownDiv
        markdown="text"
        postProcess={(html) =>
          `${html}<svg><rect ${attr}="url(https://evil.example/x.svg#p)"></rect></svg>`
        }
      />
    );

    await waitFor(() => {
      expect(container.textContent).toContain("text");
    });

    expect(container.innerHTML).not.toContain("evil.example");
  });

  it("keeps a same-document fragment reference", async () => {
    const { container } = render(
      <MarkdownDiv
        markdown="text"
        postProcess={(html) =>
          `${html}<svg><rect fill="url(#paint)"></rect></svg>`
        }
      />
    );

    await waitFor(() => {
      expect(container.querySelector("rect")).not.toBeNull();
    });

    expect(container.querySelector("rect")?.getAttribute("fill")).toBe(
      "url(#paint)"
    );
  });

  it("removes a src attribute from a non-img element", async () => {
    const { container } = render(
      <MarkdownDiv
        markdown="text"
        postProcess={(html) =>
          `${html}<math><mtext src="https://evil.example/x.png">m</mtext></math>`
        }
      />
    );

    await waitFor(() => {
      expect(container.textContent).toContain("text");
    });

    expect(container.querySelector("[src]")).toBeNull();
  });
});
