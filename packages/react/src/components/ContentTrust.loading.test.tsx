// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ComponentStateProvider } from "../state/ComponentStateContext";
import { makeStateHooks, testIcons } from "../test";

import { ANSIDisplay } from "./AnsiDisplay";
import { AsciinemaPlayer } from "./AsciinemaPlayer";
import { ComponentIconProvider } from "./ComponentIconContext";
import { ComponentNavigationProvider } from "./ComponentNavigationContext";
import { ContentTrustProvider, type ContentTrust } from "./ContentTrustContext";
import { JSONPanel } from "./JsonPanel";
import { MarkdownDiv } from "./MarkdownDiv";
import { MarkdownDivWithReferences } from "./MarkdownDivWithReferences";

// Every module that interprets content richly, recorded when first loaded.
const loaded = vi.hoisted(() => new Set<string>());

vi.mock("./markdownPipeline", async (importOriginal) => {
  loaded.add("markdownPipeline");
  return importOriginal();
});
vi.mock("./AnsiDisplayRich", async (importOriginal) => {
  loaded.add("AnsiDisplayRich");
  return importOriginal();
});
vi.mock("../hooks/prismHighlighter", async (importOriginal) => {
  loaded.add("prismHighlighter");
  return importOriginal();
});
vi.mock("./AsciinemaPlayerImpl", () => {
  loaded.add("AsciinemaPlayerImpl");
  // The real player needs a browser; loading it is what matters here.
  return { default: () => null };
});
vi.mock("markdown-it", async (importOriginal) => {
  loaded.add("markdown-it");
  return importOriginal();
});
vi.mock("markdown-it-mathjax3", async (importOriginal) => {
  loaded.add("markdown-it-mathjax3");
  return importOriginal();
});
vi.mock("dompurify", async (importOriginal) => {
  loaded.add("dompurify");
  return importOriginal();
});
vi.mock("ansi-output", async (importOriginal) => {
  loaded.add("ansi-output");
  return importOriginal();
});
vi.mock("prismjs", async (importOriginal) => {
  loaded.add("prismjs");
  return importOriginal();
});

afterEach(cleanup);

const MARKDOWN = [
  "# Heading",
  "[link](https://example.com)",
  "```python",
  "x = 1",
  "```",
].join("\n");

const renderEverything = (trust: ContentTrust) =>
  render(
    <ComponentStateProvider hooks={makeStateHooks()}>
      <ComponentIconProvider icons={testIcons}>
        <ComponentNavigationProvider navigation={{ navigate: () => {} }}>
          <ContentTrustProvider value={trust}>
            <MarkdownDiv markdown={MARKDOWN} />
            <MarkdownDiv markdown={MARKDOWN} truncateAt={10} />
            <MarkdownDiv markdown={"Math $x^2$"} />
            <MarkdownDivWithReferences
              markdown="See [M1]."
              references={[
                { id: "m1", cite: "[M1]", citeUrl: "#/logs/a.eval" },
              ]}
            />
            <ANSIDisplay output={"\u001b[32mPASS\u001b[0m"} />
            <JSONPanel data={{ key: "value" }} />
            <AsciinemaPlayer
              inputUrl="blob:a"
              outputUrl="blob:b"
              timingUrl="blob:c"
            />
          </ContentTrustProvider>
        </ComponentNavigationProvider>
      </ComponentIconProvider>
    </ComponentStateProvider>
  );

// Order matters: a module stays loaded once imported, so the untrusted case
// must run before the trusted one (vitest runs a file's tests in order).
describe("rich-rendering libraries", () => {
  it("never load for untrusted content", async () => {
    renderEverything("untrusted");
    // Give any (wrongly) scheduled lazy load time to start.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect([...loaded]).toEqual([]);
  });

  it("load for trusted content", { timeout: 30000 }, async () => {
    renderEverything("trusted");
    await waitFor(
      () => {
        expect([...loaded].sort()).toEqual(
          [
            "AnsiDisplayRich",
            "AsciinemaPlayerImpl",
            "ansi-output",
            "dompurify",
            "markdown-it",
            "markdown-it-mathjax3",
            "markdownPipeline",
            "prismHighlighter",
            "prismjs",
          ].sort()
        );
      },
      // MathJax is large; its first import can be slow on a cold runner.
      { timeout: 20000 }
    );
  });
});
