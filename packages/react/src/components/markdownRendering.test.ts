import type { MarkdownIt } from "markdown-it";
import { describe, expect, it, vi } from "vitest";

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
