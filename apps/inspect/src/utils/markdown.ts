import MarkdownIt, { type Token } from "markdown-it";

/**
 * Truncates markdown text to a target length while preserving markdown syntax
 * and avoiding word breaks.
 *
 * @param markdown - The markdown string to truncate
 * @param maxLength - Maximum character length for the output (default 250)
 * @param ellipsis - String to append when text is truncated (default "...")
 * @returns Truncated markdown string with ellipsis if needed
 */
export function truncateMarkdown(
  markdown: string,
  maxLength: number = 250,
  ellipsis: string = "..."
): string {
  // Handle edge cases
  if (!markdown || markdown.length <= maxLength) {
    return markdown;
  }

  // Handle whitespace-only strings
  if (markdown.trim().length === 0) {
    return markdown.slice(0, maxLength);
  }

  // If the ellipsis itself is too long, just return truncated text
  if (ellipsis.length >= maxLength) {
    return markdown.slice(0, maxLength);
  }

  // Sample text arrives unbounded from the log, and only ~maxLength
  // characters can ever be shown, so detection and parsing run over a
  // bounded prefix: the cost of a cell then does not grow with the sample.
  const prefix = markdown.slice(0, maxLength * kParseWindowFactor);

  // For simple cases without markdown, use simple truncation
  if (!hasMarkdownSyntax(prefix)) {
    return simpleMarkdownTruncate(prefix, maxLength, ellipsis);
  }

  // Create a markdown parser instance
  const md = new MarkdownIt({
    html: true,
    breaks: true,
  });

  // Parse the markdown into tokens
  const tokens = md.parse(prefix, {});

  // Track accumulated text and find truncation point
  let accumulated = "";
  let lastSafePoint = "";
  let isTruncated = prefix.length < markdown.length;

  // Process tokens to find safe truncation point
  for (const token of tokens) {
    const tokenContent = getTokenContent(token);
    const potentialLength = accumulated.length + tokenContent.length;

    // If adding this token would exceed the limit
    if (potentialLength > maxLength - ellipsis.length) {
      // Try to truncate within this token at a word boundary
      const remainingSpace = maxLength - ellipsis.length - accumulated.length;

      if (remainingSpace > 0 && tokenContent.length > 0) {
        // Look for word boundary within the token
        const truncatedToken = truncateAtWordBoundary(
          tokenContent,
          remainingSpace
        );
        if (truncatedToken.length > 0) {
          accumulated += truncatedToken;
        }
      }

      isTruncated = true;
      break;
    }

    accumulated += tokenContent;

    // Save safe truncation points (after complete tokens)
    if (isCompleteSyntax(token)) {
      lastSafePoint = accumulated;
    }
  }

  // Use the last safe point if we have one and it's not too short
  const finalText =
    lastSafePoint.length > maxLength * 0.5 ? lastSafePoint : accumulated;

  // Add ellipsis if truncated
  if (isTruncated && finalText.length > 0) {
    // Clean up any trailing whitespace before adding ellipsis
    return finalText.trimEnd() + ellipsis;
  }

  return finalText;
}

// 8x leaves 7 * maxLength of headroom for markup that carries no visible
// text (URLs, tags, fences) before the cut can change what is shown.
const kParseWindowFactor = 8;

/**
 * Check if text contains markdown syntax
 */
function hasMarkdownSyntax(text: string): boolean {
  if (hasLinkSyntax(text)) {
    return true;
  }

  const markdownPatterns = [
    /`[^`]+`/, // Inline code
    /```[\s\S]*?```/, // Code blocks
    /\*{1,2}[^*]+\*{1,2}/, // Bold/italic
    /_{1,2}[^_]+_{1,2}/, // Bold/italic
    /\$[^$]+\$/, // LaTeX
    /^#{1,6}\s/m, // Headers
    /^\s*[-*+]\s/m, // Lists
  ];

  return markdownPatterns.some((pattern) => pattern.test(text));
}

// What "." refuses to cross in a regex without the s flag.
const kLineTerminator = /[\n\r\u2028\u2029]/;

// Same predicate as /\[.*?\]\(.*?\)/ ("[" then "](" then ")" on one line,
// which also covers images) without its cubic backtracking on a line of many
// "[" and "](" and no ")". Backtracking-safe regex forms are still quadratic
// on "[" repeated, so this is a plain scan.
function hasLinkSyntax(text: string): boolean {
  return text.split(kLineTerminator).some((line) => {
    const open = line.indexOf("[");
    if (open < 0) {
      return false;
    }
    const close = line.indexOf("](", open + 1);
    return close >= 0 && line.indexOf(")", close + 2) >= 0;
  });
}

/**
 * Extracts the text content from a markdown token
 */
function getTokenContent(token: Token): string {
  // Handle different token types
  if (token.type === "inline" && token.children) {
    return token.children
      .map((child: Token) => {
        if (child.content) return child.content;
        if (child.type === "softbreak") return "\n";
        if (child.type === "hardbreak") return "\n";
        return "";
      })
      .join("");
  }

  if (token.content) {
    return token.content;
  }

  // Handle special tokens
  if (token.type === "code_block" || token.type === "fence") {
    return token.content || "";
  }

  if (token.type === "html_block") {
    return token.content || "";
  }

  // Handle line breaks
  if (token.type === "softbreak" || token.type === "hardbreak") {
    return "\n";
  }

  return "";
}

/**
 * Checks if a token represents a complete markdown syntax element
 */
function isCompleteSyntax(token: Token): boolean {
  // Consider a token "complete" if it's a closing tag or a complete block
  const completeTypes = [
    "paragraph_close",
    "heading_close",
    "blockquote_close",
    "list_item_close",
    "ordered_list_close",
    "bullet_list_close",
    "code_block",
    "fence",
    "hr",
    "html_block",
  ];

  return completeTypes.includes(token.type);
}

/**
 * Truncates text at the last word boundary before the limit
 */
function truncateAtWordBoundary(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  // Look for the last space before the limit
  let lastSpace = -1;

  // Search backwards from maxLength to find a word boundary
  for (let i = maxLength - 1; i >= 0; i--) {
    const char = text[i];
    if (char !== undefined && /\s/.test(char)) {
      lastSpace = i;
      break;
    }
  }

  // If we found a space, use it
  if (lastSpace > 0) {
    return text.slice(0, lastSpace);
  }

  // Otherwise, look for other breaking characters
  for (let i = maxLength - 1; i >= 0; i--) {
    const char = text[i];
    if (char !== undefined && /[.!?,;:\-—]/.test(char)) {
      return text.slice(0, i + 1);
    }
  }

  // If no good break point, check for incomplete markdown syntax
  const substr = text.slice(0, maxLength);

  // Check for incomplete markdown syntax at the end
  const markdownPatterns = [
    /\[([^\]]*)?$/, // Incomplete link
    /!\[([^\]]*)?$/, // Incomplete image
    /`[^`]*$/, // Incomplete inline code
    /\*{1,2}[^*]*$/, // Incomplete bold/italic
    /_{1,2}[^_]*$/, // Incomplete bold/italic
    /\$[^$]*$/, // Incomplete LaTeX
  ];

  for (const pattern of markdownPatterns) {
    const match = substr.match(pattern);
    if (match && match.index) {
      // Truncate before the incomplete syntax
      return substr.slice(0, match.index);
    }
  }

  // Last resort: return the substring
  return substr;
}

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
