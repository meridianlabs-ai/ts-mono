import { describe, expect, it } from "vitest";

import { renderMarkdown, segmentMarkdown } from "./markdownRendering";

const document = [
  "# Title",
  "",
  "Intro paragraph with **bold**, `code`, and a [reference link][docs].",
  "",
  "## Lists",
  "",
  "- tight one",
  "- tight two",
  "  - nested",
  "",
  "1. loose one",
  "",
  "2. loose two",
  "",
  "a) lettered choice",
  "b) another choice",
  "",
  "```python",
  "def f(x):",
  "    return x < 3 and x > 1",
  "```",
  "",
  "| a | b |",
  "|---|---|",
  "| 1 | <b>2</b> |",
  "",
  "> quoted",
  "> lines",
  "",
  "Inline math $x^2$ and a block:",
  "",
  "$$\\sum_{k=1}^{n} k$$",
  "",
  "---",
  "",
  "Last paragraph.\r\nWith a CRLF line.",
  "",
  "[docs]: https://example.com/docs",
  "",
].join("\n");

// A segment at every block that may start one; no block counts as huge.
const kEverySegment = { size: 1, hugeBlock: Infinity };

// MathJax gives each formula a random element id.
const withoutMathIds = (html: string) => html.replace(/mjx-[0-9a-f]+/g, "mjx");

describe("segmentMarkdown", () => {
  it("renders the same HTML as the whole document", async () => {
    const whole = await renderMarkdown(document, "full");
    const { segments, render } = await segmentMarkdown(
      document,
      "full",
      kEverySegment
    );
    expect(segments.length).toBeGreaterThan(5);
    expect(withoutMathIds(segments.map(render).join(""))).toBe(
      withoutMathIds(whole)
    );
  });

  it("keeps the source of every line, in order", async () => {
    const { segments } = await segmentMarkdown(document, "full", kEverySegment);
    expect(segments.map((s) => s.source).join("")).toBe(
      document.replace(/\r\n?/g, "\n")
    );
    for (const segment of segments) {
      expect(segment.prepared.split("\n")).toHaveLength(
        segment.source.split("\n").length
      );
    }
  });

  it("starts segments only at blocks with no top margin", async () => {
    const { segments } = await segmentMarkdown(document, "full", kEverySegment);
    for (const segment of segments.slice(1)) {
      expect(segment.source).not.toMatch(/^(#|---|\$\$)/);
    }
  });

  it("keeps the first and last segments to the blocks at the edges", async () => {
    const { segments } = await segmentMarkdown(document, "full", {
      size: 1_000_000,
      hugeBlock: Infinity,
    });
    const normalized = document.replace(/\r\n?/g, "\n");
    const lastBlock = normalized.indexOf("Last paragraph.");
    expect(segments.map((s) => s.source)).toEqual([
      "# Title\n\n",
      normalized.slice("# Title\n\n".length, lastBlock),
      normalized.slice(lastBlock),
    ]);
  });

  it("gives a huge fenced code block its own plain segment of the code", async () => {
    const code = Array.from({ length: 50 }, (_, i) => `line ${i} < x`).join(
      "\n"
    );
    const doc = `Before.\n\n\`\`\`text\n${code}\n\`\`\`\n## After\n\nAfter.\n`;
    const { segments } = await segmentMarkdown(doc, "full", {
      size: 1_000_000,
      hugeBlock: 200,
    });
    expect(segments.map((s) => s.source).join("")).toBe(doc);
    expect(segments.map((s) => s.plain)).toEqual([
      undefined,
      { text: `${code}\n`, code: true },
      undefined,
      undefined,
    ]);
  });

  it("shows any other huge block as its source", async () => {
    const paragraph = Array.from(
      { length: 50 },
      (_, i) => `**line ${i}**`
    ).join("\n");
    const doc = `# Title\n\n${paragraph}\n`;
    const { segments } = await segmentMarkdown(doc, "full", {
      size: 1_000_000,
      hugeBlock: 200,
    });
    expect(segments.at(-1)?.plain).toEqual({
      text: `${paragraph}\n`,
      code: false,
    });
  });
});
