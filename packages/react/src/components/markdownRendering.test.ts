import type { MarkdownIt } from "markdown-it";
import { describe, expect, it, vi } from "vitest";

import {
  protectMarkdown,
  renderMarkdown,
  restoreBackslashesForLatex,
} from "./markdownRendering";

describe("lazy mathjax loading", () => {
  // Extended timeout: importing markdownRendering's module graph (markdown-it
  // + @tsmono/util) still measured ~3s under heavy CPU contention.
  it(
    "retries the mathjax import after a failed chunk load",
    { timeout: 10_000 },
    async () => {
      vi.resetModules();
      let failImport = true;
      // Stub the multi-MB mathjax module: the contract under test is the
      // import-retry logic, and the real module's parse/eval blows the 5s
      // timeout under parallel turbo CPU load.
      vi.doMock("markdown-it-mathjax3", () => {
        if (failImport) {
          throw new Error("chunk load failed");
        }
        return {
          default: (md: MarkdownIt) => {
            md.renderer.rules.text = (tokens, idx) =>
              `<mjx-container>${md.utils.escapeHtml(tokens[idx]?.content ?? "")}</mjx-container>`;
          },
        };
      });

      const { renderMarkdown } = await import("./markdownRendering");

      const degraded = await renderMarkdown("$\\frac{1}{2}$");
      expect(degraded).not.toContain("mjx-container");

      failImport = false;
      const rendered = await renderMarkdown("$\\frac{1}{2}$");
      expect(rendered).toContain("mjx-container");

      vi.doUnmock("markdown-it-mathjax3");
    }
  );
});

const elapsedMs = (fn: () => unknown): number => {
  const start = performance.now();
  fn();
  return performance.now() - start;
};

describe("protectMarkdown", () => {
  it("runs in linear time on a long run of unclosed brackets", () => {
    const text = "[".repeat(250_000);
    let result = "";
    const ms = elapsedMs(() => {
      result = protectMarkdown(text);
    });
    expect(result).toBe(text);
    expect(ms).toBeLessThan(1000);
  });

  it("protects a non-http reference definition at line start", () => {
    expect(protectMarkdown("[note]: some text\nnext line"))
      .toMatchInlineSnapshot(`
      "(open:767A125E)note(close:767A125E) some text 
      next line"
    `);
  });

  it("leaves an http reference definition alone", () => {
    expect(protectMarkdown("[1]: http://example.com/a")).toMatchInlineSnapshot(
      `"[1]: http://example.com/a"`
    );
  });

  it("keeps protecting a mid-line definition", () => {
    expect(protectMarkdown("see [x]: y here\nafter")).toMatchInlineSnapshot(`
      "see (open:767A125E)x(close:767A125E) y here 
      after"
    `);
  });

  it("keeps protecting a label that spans lines", () => {
    expect(protectMarkdown("[a\nb]: c\nd")).toMatchInlineSnapshot(`
      "(open:767A125E)a
      b(close:767A125E) c 
      d"
    `);
  });

  it("handles empty labels and empty definitions", () => {
    expect(protectMarkdown("[]: x")).toMatchInlineSnapshot(
      `"(open:767A125E)(close:767A125E) x "`
    );
    expect(protectMarkdown("[a]: ")).toMatchInlineSnapshot(
      `"(open:767A125E)a(close:767A125E)  "`
    );
    expect(protectMarkdown("[a]: \nb")).toMatchInlineSnapshot(`
      "(open:767A125E)a(close:767A125E)  
      b"
    `);
  });

  it("only pairs a bracket with the first closing bracket", () => {
    expect(protectMarkdown("[a[b]: c](url)")).toMatchInlineSnapshot(
      `"(open:767A125E)a[b(close:767A125E) c](url) "`
    );
    expect(protectMarkdown("[a]x[b]: c")).toMatchInlineSnapshot(
      `"[a]x(open:767A125E)b(close:767A125E) c "`
    );
  });
});

describe("restoreBackslashesForLatex dots notation", () => {
  it("runs in linear time on an unclosed inline expression full of \\dots", () => {
    const text = "$" + "\\dots ".repeat(50_000);
    let result = "";
    const ms = elapsedMs(() => {
      result = restoreBackslashesForLatex(text);
    });
    expect(result).toBe(text);
    expect(ms).toBeLessThan(1000);
  });

  it("runs in linear time on an unclosed display expression full of \\dots", () => {
    const text = "$$" + "\\dots ".repeat(50_000);
    let result = "";
    const ms = elapsedMs(() => {
      result = restoreBackslashesForLatex(text);
    });
    expect(result).toBe(text);
    expect(ms).toBeLessThan(1000);
  });

  it("runs in linear time on many dollar signs with a trailing \\dots", () => {
    const text = "$ ".repeat(100_000) + "\\dots";
    const ms = elapsedMs(() => restoreBackslashesForLatex(text));
    expect(ms).toBeLessThan(1000);
  });

  it("rewrites \\dots inside inline math", () => {
    expect(restoreBackslashesForLatex("$a \\dots b$")).toMatchInlineSnapshot(
      `"$a \\ldots b$"`
    );
  });

  it("rewrites \\dots inside display math", () => {
    expect(restoreBackslashesForLatex("$$a \\dots b$$")).toMatchInlineSnapshot(
      `"$$a \\ldots b$$"`
    );
  });

  it("rewrites \\dots inside inline math that spans lines", () => {
    expect(restoreBackslashesForLatex("$a\n\\dots\nb$")).toMatchInlineSnapshot(`
      "$a
      \\ldots
      b$"
    `);
  });

  it("leaves \\dots outside math alone", () => {
    expect(restoreBackslashesForLatex("a \\dots b")).toMatchInlineSnapshot(
      `"a \\dots b"`
    );
    expect(restoreBackslashesForLatex("$a \\dots b")).toMatchInlineSnapshot(
      `"$a \\dots b"`
    );
  });

  it("keeps the per-expression replacement count", () => {
    expect(
      restoreBackslashesForLatex("$a \\dots b \\dots c$")
    ).toMatchInlineSnapshot(`"$a \\ldots b \\dots c$"`);
    expect(
      restoreBackslashesForLatex("$$a \\dots b \\dots c \\dots d$$")
    ).toMatchInlineSnapshot(`"$$a \\ldots b \\ldots c \\dots d$$"`);
    expect(
      restoreBackslashesForLatex("$a$ \\dots $b$ and $c \\dots$")
    ).toMatchInlineSnapshot(`"$a$ \\ldots $b$ and $c \\ldots$"`);
  });
});

describe("renderMarkdown reference definitions", () => {
  it("renders a mid-line definition-like span", async () => {
    expect(await renderMarkdown("see [x]: y here")).toMatchInlineSnapshot(`
      "<p>see [x] y here</p>
      "
    `);
  });

  it("renders a non-http definition as text", async () => {
    expect(await renderMarkdown("[note]: some text")).toMatchInlineSnapshot(`
      "<p>[note] some text</p>
      "
    `);
  });

  it("resolves a real reference link", async () => {
    expect(await renderMarkdown("[link][1]\n\n[1]: http://example.com/a"))
      .toMatchInlineSnapshot(`
      "<p><a href="http://example.com/a">link</a></p>
      "
    `);
  });
});
