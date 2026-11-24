// Library-free markdown helpers, safe to import anywhere. The markdown
// pipeline itself (markdown-it, DOMPurify, MathJax) loads on demand for
// trusted content only; see markdownPipeline.ts.

export type MarkdownRenderer = "full" | "textOnly" | "fragment";

export const defaultMarkdownRenderer: MarkdownRenderer = "full";

// Markdown-aware truncation to `maxLength` reads at most this many times
// `maxLength` characters (see markdownTruncate.ts). 8x leaves 7 * maxLength of
// headroom for markup that carries no visible text (URLs, tags, fences)
// before the cut can change what is shown.
export const kTruncationWindowFactor = 8;

/**
 * The part of `text` that truncating it to `maxLength` can depend on (plus
 * one character, which keeps "was the text longer?"). Cutting to it first
 * leaves the truncated result unchanged but bounds the work, and the length
 * of what callers pass on or key caches by.
 */
export const truncationWindow = (text: string, maxLength: number): string =>
  text.slice(0, maxLength * kTruncationWindowFactor + 1);

export const escapeHtmlCharacters = (content: string): string => {
  if (!content) return content;

  return content.replace(/[<>&'"]/g, (c: string): string => {
    switch (c) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case "'":
        return "&apos;";
      case '"':
        return "&quot;";
      default:
        throw new Error("Matched a value that isn't replaceable");
    }
  });
};

/**
 * Simple markdown truncation that falls back to basic string slicing
 * This is a faster alternative when markdown parsing isn't critical
 */
export function simpleMarkdownTruncate(
  markdown: string,
  maxLength: number = 250,
  ellipsis: string = "..."
): string {
  if (!markdown || markdown.length <= maxLength) {
    return markdown;
  }

  const targetLength = maxLength - ellipsis.length;
  const truncated = markdown.slice(0, targetLength);

  // Find the last space to avoid cutting words
  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > 0) {
    return truncated.slice(0, lastSpace) + ellipsis;
  }

  // If no space found, just truncate at target length
  return truncated + ellipsis;
}
