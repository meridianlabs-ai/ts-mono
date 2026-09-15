import { describe, expect, it } from "vitest";

import { simpleMarkdownTruncate, truncateMarkdown } from "./markdown";

describe("truncateMarkdown", () => {
  describe("basic truncation", () => {
    it("should return unchanged text if within limit", () => {
      const text = "Short text";
      expect(truncateMarkdown(text, 50)).toBe(text);
    });

    it("should truncate long text with ellipsis", () => {
      const text =
        "This is a very long text that needs to be truncated because it exceeds the maximum allowed length";
      const result = truncateMarkdown(text, 30);
      expect(result.length).toBeLessThanOrEqual(30);
      expect(result).toContain("...");
    });

    it("should handle empty string", () => {
      expect(truncateMarkdown("", 50)).toBe("");
    });

    it("should handle null/undefined gracefully", () => {
      /* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- deliberately out of contract: the case covers truncateMarkdown's runtime nullish guard, which its signature forbids reaching */
      expect(truncateMarkdown(null as unknown as string, 50)).toBe(null);
      expect(truncateMarkdown(undefined as unknown as string, 50)).toBe(
        undefined
      );
      /* eslint-enable @typescript-eslint/no-unsafe-type-assertion */
    });
  });

  describe("word boundary detection", () => {
    it("should not cut words in the middle", () => {
      const text = "Hello world this is a test";
      const result = truncateMarkdown(text, 13); // Would cut "world" in middle
      expect(result).toBe("Hello...");
      expect(result).not.toContain("wo");
    });

    it("should find the last complete word", () => {
      const text = "The quick brown fox jumps over the lazy dog";
      const result = truncateMarkdown(text, 20);
      expect(result).toBe("The quick brown...");
    });
  });

  describe("markdown syntax preservation", () => {
    it("should not break links", () => {
      const text = "Check out [this link](https://example.com) for more info";
      const result = truncateMarkdown(text, 15);
      // Should truncate before the link starts
      expect(result).toBe("Check out...");
      expect(result).not.toContain("[");
    });

    it("should not break inline code", () => {
      const text = "Use the `processData()` function to handle the data";
      const result = truncateMarkdown(text, 20);
      // Should include or exclude the whole code block
      expect(result).toMatch(/^Use the(\.\.\.|.*`processData\(\)`.*)/);
    });

    it("should not break bold text", () => {
      const text = "This is **very important** information to know";
      const result = truncateMarkdown(text, 15);
      expect(result).toBe("This is...");
      expect(result).not.toContain("**very");
    });

    it("should not break italic text", () => {
      const text = "This is *emphasized* text here";
      const result = truncateMarkdown(text, 12);
      expect(result).toBe("This is...");
      expect(result).not.toContain("*emph");
    });

    it("should handle code blocks", () => {
      const text =
        "Here is code:\n```javascript\nfunction test() {}\n```\nMore text";
      const result = truncateMarkdown(text, 25);
      expect(result.includes("```")).toBeFalsy();
    });

    it("should handle images", () => {
      const text = "Look at ![alt text](image.png) this image";
      const result = truncateMarkdown(text, 10);
      // With 10 chars, we can fit "Look" + "..."
      expect(result).toBe("Look...");
      expect(result).not.toContain("![");
    });

    it("should handle LaTeX expressions", () => {
      const text = "The equation $x + y = z$ shows the relationship";
      const result = truncateMarkdown(text, 20);
      // The function detects the LaTeX and tries to avoid breaking it
      // It should truncate the LaTeX expression cleanly
      expect(result).toBe("The equation $x...");
    });
  });

  describe("ellipsis handling", () => {
    it("should add custom ellipsis", () => {
      const text = "Long text that will be truncated";
      const result = truncateMarkdown(text, 15, " [...]");
      expect(result).toContain(" [...]");
    });

    it("should not add ellipsis if text fits", () => {
      const text = "Short";
      const result = truncateMarkdown(text, 50);
      expect(result).toBe(text);
      expect(result).not.toContain("...");
    });

    it("should handle ellipsis that's too long", () => {
      const text = "Test text here";
      const result = truncateMarkdown(text, 5, ".......");
      expect(result).toBe("Test ");
    });
  });

  describe("edge cases", () => {
    it("should handle text with only whitespace", () => {
      const text = "    \n\n\t  ";
      const result = truncateMarkdown(text, 5);
      // Whitespace-only strings are truncated to max length
      expect(result.length).toBe(5);
      // The actual content will be the first 5 characters of the whitespace string
      expect(result).toBe("    \n");
    });

    it("should handle text with multiple line breaks", () => {
      const text = "Line 1\n\nLine 2\n\nLine 3";
      const result = truncateMarkdown(text, 10);
      expect(result.length).toBeLessThanOrEqual(10);
    });

    it("should handle nested markdown", () => {
      const text = "This has **bold with `code` inside** it";
      const result = truncateMarkdown(text, 15);
      expect(result).toBe("This has...");
    });

    it("should handle lists", () => {
      const text = "Items:\n- First\n- Second\n- Third";
      const result = truncateMarkdown(text, 15);
      expect(result.length).toBeLessThanOrEqual(15);
    });

    it("should handle headings", () => {
      const text = "# Heading\n\nContent after heading";
      const result = truncateMarkdown(text, 12);
      expect(result.length).toBeLessThanOrEqual(12);
    });
  });

  describe("output parity", () => {
    it("pins truncation of text with a link", () => {
      const text =
        "Read the [inspect docs](https://inspect.aisi.org.uk/) before you start writing evals, then come back here for the rest of the walkthrough.";
      expect(truncateMarkdown(text, 60)).toBe(
        "Read the inspect docs before you start writing evals,..."
      );
    });

    it("pins truncation of text with an image", () => {
      const text =
        "Diagram: ![architecture overview](https://example.com/arch.png) shows how the solver, scorer and model interact during a run.";
      expect(truncateMarkdown(text, 50)).toBe(
        "Diagram: architecture overview shows how the..."
      );
    });

    it("pins truncation of text with a fenced block", () => {
      const text =
        "Run this first:\n```python\nprint('hello world')\n```\nThen inspect the output carefully and report anything odd.";
      expect(truncateMarkdown(text, 70)).toBe(
        "Run this first:print('hello world')..."
      );
    });

    it("pins truncation of plain text", () => {
      const text =
        "The quick brown fox jumps over the lazy dog while the cat watches from the window sill.";
      expect(truncateMarkdown(text, 40)).toBe(
        "The quick brown fox jumps over the..."
      );
    });
  });

  describe("adversarial input", () => {
    // Log-authored sample text reaches truncateMarkdown unbounded, so its
    // cost must not grow with the size of the string. Bounds are generous:
    // the fixed path takes single-digit milliseconds.
    const kBudgetMs = 200;

    it("does not backtrack cubically on a line of repeated '[]('", () => {
      const text = "[](".repeat(2000);
      const start = performance.now();
      const result = truncateMarkdown(text, 250);
      expect(performance.now() - start).toBeLessThan(kBudgetMs);
      expect(result.length).toBeLessThanOrEqual(250);
    });

    it("does not scan quadratically on a line of repeated '['", () => {
      const text = "[".repeat(30_000);
      const start = performance.now();
      const result = truncateMarkdown(text, 250);
      expect(performance.now() - start).toBeLessThan(kBudgetMs);
      expect(result.length).toBeLessThanOrEqual(250);
    });

    it("costs the same for a 300KB sample as for a short one", () => {
      const text = "[](".repeat(100_000) + " " + "word ".repeat(20_000);
      const start = performance.now();
      const result = truncateMarkdown(text, 360);
      expect(performance.now() - start).toBeLessThan(kBudgetMs);
      expect(result.length).toBeLessThanOrEqual(360);
    });

    it("keeps the ellipsis when the bounded window hides later content", () => {
      // A setext underline carries no visible text, so the window ends
      // before any content limit is reached; the text is still truncated.
      const text = "Title *now*\n" + "=".repeat(5000) + "\n\nMore text after";
      expect(truncateMarkdown(text, 250)).toBe("Title now...");
    });
  });

  describe("default values", () => {
    it("should use default max length of 250", () => {
      const text = "a".repeat(300);
      const result = truncateMarkdown(text);
      expect(result.length).toBeLessThanOrEqual(250);
      expect(result).toContain("...");
    });

    it("should use default ellipsis", () => {
      const text = "a".repeat(300);
      const result = truncateMarkdown(text, 50);
      expect(result).toContain("...");
    });
  });
});

describe("simpleMarkdownTruncate", () => {
  it("should perform basic truncation", () => {
    const text = "This is a long text that needs truncation";
    const result = simpleMarkdownTruncate(text, 20);
    expect(result.length).toBeLessThanOrEqual(20);
    expect(result).toContain("...");
  });

  it("should avoid cutting words when possible", () => {
    const text = "Hello world this is test";
    const result = simpleMarkdownTruncate(text, 13);
    expect(result).toBe("Hello...");
  });

  it("should handle short text", () => {
    const text = "Short";
    expect(simpleMarkdownTruncate(text, 50)).toBe(text);
  });

  it("should use custom ellipsis", () => {
    const text = "Long text for truncation";
    const result = simpleMarkdownTruncate(text, 15, " [more]");
    expect(result).toContain(" [more]");
  });

  it("should handle edge case where no good space is found", () => {
    const text = "verylongwordwithoutanyspaces";
    const result = simpleMarkdownTruncate(text, 10);
    expect(result).toBe("verylon...");
  });
});
