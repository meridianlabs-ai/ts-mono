/**
 * Pure functions for the markdown rendering pipeline.
 * Extracted for testability (no CSS/React imports).
 */

import markdownit, { type Env, type MarkdownIt, type Token } from "markdown-it";

import {
  canonicalImageSource,
  parseAbsoluteHttpUrl,
  parseDataUri,
} from "@tsmono/util";

import {
  defaultMarkdownRenderer,
  escapeHtmlCharacters,
  kSourceLinesAttribute,
  type MarkdownRenderer,
} from "./markdownText";

type MarkdownItPlugin = (md: MarkdownIt) => void;

let mathjaxPluginPromise: Promise<MarkdownItPlugin> | null = null;
export const getMathjaxPlugin = (): Promise<MarkdownItPlugin> => {
  if (!mathjaxPluginPromise) {
    const loading = import("markdown-it-mathjax3").then(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- untyped dependency: markdown-it-mathjax3 ships no types, so its default export arrives as any
      (m) => m.default as MarkdownItPlugin
    );
    // Reset on rejection so a transient chunk-load failure (network blip,
    // redeploy invalidating the hashed chunk) retries on the next math render
    // instead of disabling math for the rest of the session.
    loading.catch(() => {
      if (mathjaxPluginPromise === loading) {
        mathjaxPluginPromise = null;
      }
    });
    mathjaxPluginPromise = loading;
  }
  return mathjaxPluginPromise;
};

// markdown-it-mathjax3 opens each formula with its own <style>. The viewer
// loads those rules from mathjax.css instead, and the sheet is dropped here,
// before any parse: even an inert parse of an inline <style> (the sanitizer's
// DOMParser) is reported as a CSP violation.
const MATHJAX_STYLE =
  /^(\s*<span id="mjx-[a-f0-9]+">\s*)<style>[\s\S]*?<\/style>/i;

const withoutMathJaxStyle = (html: string): string =>
  html.replace(MATHJAX_STYLE, "$1");

export const hasMathContent = (text: string): boolean =>
  text.includes("$") || text.includes("\\(") || text.includes("\\[");

// Module-level cache for lazy-initialized markdown-it instances
const mdInstanceCache: Record<string, MarkdownIt> = {};

/** Unescape HTML entities within math token content before MathJax processing.
 *  This is safe because MathJax renders TeX to SVG/MathML, not raw HTML. */
export const unescapeHtmlForMath = (content: string): string => {
  return content
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"');
};

export const getMarkdownInstance = async (
  renderer: MarkdownRenderer,
  contentHasMath?: boolean
): Promise<MarkdownIt> => {
  const useMath =
    (renderer === "full" || renderer === "fragment") && !!contentHasMath;
  const cacheKey = `${renderer}:${useMath ? "1" : "0"}`;

  const cached = mdInstanceCache[cacheKey];
  if (cached) {
    return cached;
  }

  if (renderer === "textOnly") {
    const md = new markdownit("zero", { breaks: true, html: false }).enable([
      "emphasis",
      "newline",
    ]);
    mdInstanceCache[cacheKey] = md;
    return md;
  }

  const md = new markdownit({ breaks: true, html: true });
  md.renderer.rules.image = (tokens, idx) => {
    const token = tokens[idx];
    if (!token) {
      return "";
    }

    // attrGet returns string | number as of markdown-it 15
    const source = String(token.attrGet("src") ?? "");
    const alt = token.content.trim();

    // Base64 raster data URIs issue no network request, so rendering them
    // inline cannot leak a fetch to an attacker-controlled host. Emit the
    // canonical form, not the raw source — see canonicalImageSource.
    const canonicalSource = canonicalImageSource(source);
    if (canonicalSource !== undefined) {
      const title = token.attrGet("title");
      const titleAttr = title
        ? ` title="${md.utils.escapeHtml(String(title))}"`
        : "";
      return `<img src="${md.utils.escapeHtml(canonicalSource)}" alt="${md.utils.escapeHtml(alt)}"${titleAttr}>`;
    }

    const href = parseAbsoluteHttpUrl(source);
    const dataUri = parseDataUri(source);
    const visibleSource =
      href ??
      (dataUri
        ? `data:${dataUri.mimeType}${dataUri.base64 ? ";base64" : ""},...`
        : source);
    const label = alt ? `${alt} (${visibleSource})` : visibleSource;
    const escapedLabel = md.utils.escapeHtml(label);

    if (!href) {
      return escapedLabel;
    }

    return `<a href="${md.utils.escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapedLabel}</a>`;
  };

  if (useMath) {
    const mathjaxPlugin = await getMathjaxPlugin();
    md.use(mathjaxPlugin);

    // Wrap math renderers to unescape HTML entities in TeX content
    // before MathJax processes them. HTML chars in LaTeX blocks are
    // entity-encoded by the pipeline for XSS safety, but MathJax needs
    // the raw characters (e.g. < for \lt comparisons). This is safe
    // because MathJax renders to SVG, not to injectable HTML.
    const origInline = md.renderer.rules.math_inline;
    const origBlock = md.renderer.rules.math_block;

    if (origInline) {
      md.renderer.rules.math_inline = (tokens, idx, options, env, self) => {
        const token = tokens[idx];
        if (token) {
          token.content = unescapeHtmlForMath(token.content);
        }
        return withoutMathJaxStyle(origInline(tokens, idx, options, env, self));
      };
    }
    if (origBlock) {
      md.renderer.rules.math_block = (tokens, idx, options, env, self) => {
        const token = tokens[idx];
        if (token) {
          token.content = unescapeHtmlForMath(token.content);
        }
        return withoutMathJaxStyle(origBlock(tokens, idx, options, env, self));
      };
    }
  }
  mdInstanceCache[cacheKey] = md;

  return md;
};

export const protectBackslashesInLatex = (content: string): string => {
  if (!content) return content;

  try {
    // Match inline math: $...$
    const inlineRegex = /\$(.*?)\$/g;

    // Match block math: $$...$$
    const blockRegex = /\$\$([\s\S]*?)\$\$/g;

    // Replace backslashes in LaTeX blocks with placeholders to protect them
    // from HTML escaping. Only backslashes need protection — other characters
    // (<, >, &, ', ") are left for escapeHtmlCharacters to handle, and then
    // unescaped specifically within MathJax token rendering (see getMarkdownInstance).
    let result = content.replace(
      inlineRegex,
      (_match: string, latex: string) => {
        const protectedTex = latex.replace(/\\/g, "___LATEX_BACKSLASH___");
        return `$${protectedTex}$`;
      }
    );

    result = result.replace(blockRegex, (_match: string, latex: string) => {
      const protectedTex = latex.replace(/\\/g, "___LATEX_BACKSLASH___");
      return `$$${protectedTex}$$`;
    });

    return result;
  } catch (error) {
    console.error("Error protecting LaTeX content:", error);
    return content;
  }
};

export const restoreBackslashesForLatex = (content: string): string => {
  if (!content) {
    return content;
  }

  try {
    // Restore only backslash placeholders — other characters (<, >, &, ', ")
    // are kept as HTML entities and unescaped within MathJax token rendering.
    let result = content.replace(/___LATEX_BACKSLASH___/g, "\\");

    // Then fix dots notation for better MathJax compatibility
    // This replaces \dots with \ldots which has better support
    result = fixDotsNotation(result);

    return result;
  } catch (error) {
    console.error("Error restoring LaTeX content:", error);
    return content; // Return input content if something goes wrong
  }
};

// Replaces the first `\dots` inside each delimited math run with `\ldots`
// (MathJax supports the latter more reliably). Equivalent to the regex
// /(<delim>[^$]*?)\\dots([^$]*?<delim>)/g, but driven by indexOf: with the
// regex, an unclosed delimiter rescanned to end-of-input from every `\dots`.
const replaceDotsBetween = (content: string, delim: "$" | "$$"): string => {
  let out = "";
  let emitted = 0;
  let search = 0;
  let nextDots = content.indexOf("\\dots");
  while (nextDots !== -1) {
    const open = content.indexOf(delim, search);
    if (open === -1) break;
    const bodyStart = open + delim.length;
    const close = content.indexOf("$", bodyStart);
    if (close === -1) break;
    if (nextDots < bodyStart) {
      nextDots = content.indexOf("\\dots", bodyStart);
      if (nextDots === -1) break;
    }
    if (nextDots < close && content.startsWith(delim, close)) {
      out += `${content.slice(emitted, nextDots)}\\ldots`;
      emitted = nextDots + "\\dots".length;
      search = close + delim.length;
    } else {
      search = open + 1;
    }
  }
  return emitted === 0 ? content : out + content.slice(emitted);
};

const fixDotsNotation = (content: string): string => {
  if (!content) return content;
  return replaceDotsBetween(replaceDotsBetween(content, "$"), "$$");
};

const kLetterListPattern = /^([a-zA-Z][).]\s.*?)$/gm;

export const preRenderText = (txt: string): string => {
  if (!txt) return txt;

  // eslint-disable-next-line no-misleading-character-class
  txt = txt.replace(/^[\u200B\u200C\u200D\u200E\u200F\uFEFF]/, "");

  // Special handling for ordered lists that look like
  // multiple choice (e.g. a), b), c), d) etc..)
  return txt.replaceAll(
    kLetterListPattern,
    "<p class='markdown-ordered-list-item'>$1</p>"
  );
};

// Line terminators are the characters an unflagged regex `.` refuses to match.
const isLineTerminator = (code: number): boolean =>
  code === 0x0a || code === 0x0d || code === 0x2028 || code === 0x2029;

// Hides `[label]: text` spans from markdown-it's reference-definition rule.
// Equivalent to replacing /\[([^\]]*)\]: (?!http)(.*)/g with
// "(open:767A125E)$1(close:767A125E) $2 ", but driven by indexOf: every `[`
// ahead of a given `]` pairs with that same `]`, so a failed pair skips past
// it instead of rescanning from each `[` (quadratic on a run of `[`).
export const protectMarkdown = (txt: string): string => {
  if (!txt) return txt;

  let out = "";
  let emitted = 0;
  let search = 0;
  for (;;) {
    const open = txt.indexOf("[", search);
    if (open === -1) break;
    const close = txt.indexOf("]", open + 1);
    if (close === -1) break;
    if (!txt.startsWith("]: ", close) || txt.startsWith("http", close + 3)) {
      search = close + 1;
      continue;
    }
    const bodyStart = close + 3;
    let lineEnd = bodyStart;
    while (lineEnd < txt.length && !isLineTerminator(txt.charCodeAt(lineEnd))) {
      lineEnd++;
    }
    out += `${txt.slice(emitted, open)}(open:767A125E)${txt.slice(open + 1, close)}(close:767A125E) ${txt.slice(bodyStart, lineEnd)} `;
    emitted = lineEnd;
    search = lineEnd;
  }
  return emitted === 0 ? txt : out + txt.slice(emitted);
};

export const unprotectMarkdown = (txt: string): string => {
  if (!txt) return txt;

  txt = txt.replaceAll("(open:767A125E)", "[");
  txt = txt.replaceAll("(close:767A125E)", "]");
  return txt;
};

export function unescapeSupHtmlEntities(str: string): string {
  if (!str) {
    return str;
  }
  return str
    .replace(/&lt;sup&gt;/g, "<sup>")
    .replace(/&lt;\/sup&gt;/g, "</sup>");
}

export function unescapeCodeHtmlEntities(str: string): string {
  if (!str) return str;

  const htmlEntities: Record<string, string> = {
    "&lt;": "<",
    "&gt;": ">",
    "&amp;": "&",
    "&#x5C;": "\\",
    "&quot;": '"',
  };

  return str.replace(
    /(<code[^>]*>)([\s\S]*?)(<\/code>)/gi,
    (
      _match: string,
      starttag: string,
      content: string,
      endtag: string
    ): string => {
      return (
        starttag +
        content.replace(
          /&(?:amp|lt|gt|quot|#39|#x2F|#x5C|#96);/g,
          (entity: string): string => htmlEntities[entity] || entity
        ) +
        endtag
      );
    }
  );
}

type MarkdownRenderFunction = (markdown: string) => Promise<string>;

// The pipeline's text transforms before markdown-it. None of them adds or
// removes a line, so line numbers in the prepared text match the source.
const prepareFullPipelineMarkdown = (markdown: string): string => {
  // Protect backslashes in LaTeX expressions
  const protectedContent = protectBackslashesInLatex(markdown);

  // Escape all tags
  const escaped = escapeHtmlCharacters(protectedContent);

  // Pre-render any text that isn't handled by markdown
  const preRendered = preRenderText(escaped);

  const protectedText = protectMarkdown(preRendered);

  // Restore backslashes for LaTeX processing
  return restoreBackslashesForLatex(protectedText);
};

const finishFullPipelineHtml = (html: string): string => {
  const unescaped = unprotectMarkdown(html);

  // For `code` tags, reverse the escaping if we can
  const withCode = unescapeCodeHtmlEntities(unescaped);

  // For `sup` tags, reverse the escaping if we can
  return unescapeSupHtmlEntities(withCode);
};

const renderFullPipelineMarkdown = async (
  markdown: string,
  renderer: "full" | "fragment"
): Promise<string> => {
  const preparedForMarkdown = prepareFullPipelineMarkdown(markdown);

  let html = preparedForMarkdown;
  try {
    const md = await getMarkdownInstance(renderer, hasMathContent(markdown));
    html = md.render(preparedForMarkdown);
  } catch (ex) {
    console.log("Unable to markdown render content");
    console.error(ex);
  }

  return finishFullPipelineHtml(html);
};

/** A run of top-level blocks of a markdown document. */
export interface MarkdownSegment {
  /** The segment's markdown source, shown until it renders. */
  source: string;
  /** The segment's text as the pipeline prepared it for markdown-it. */
  prepared: string;
  /** Lines in the source. */
  lines: number;
  /** Set for a single top-level block too large to render as markdown in
   *  one piece: the text to show as plain text instead, and whether it is
   *  the content of a code block. */
  plain?: { text: string; code: boolean };
}

export interface SegmentedMarkdown {
  segments: MarkdownSegment[];
  /** Renders a segment to unsanitized HTML; reference links resolve against
   *  the whole document. */
  render: (segment: MarkdownSegment) => string;
}

// markdown-it's own newline normalization, applied up front so its block
// parse's line numbers index the same lines as the source.
const kNewlines = /\r\n?|\n/g;

// Block types a segment may start at. Their top margin is zero, so the gap
// above them is the previous block's bottom margin whether or not a segment
// boundary (a block formatting context) sits between them.
const kSegmentStarts = new Set([
  "paragraph_open",
  "bullet_list_open",
  "ordered_list_open",
  "fence",
  "code_block",
  "table_open",
  "blockquote_open",
]);

export interface SegmentOptions {
  /** Target segment length in characters. */
  size: number;
  /** A top-level block longer than this gets a segment of its own, shown as
   *  plain text (`MarkdownSegment.plain`). */
  hugeBlock: number;
}

/**
 * Splits a markdown document into segments of about `size` characters that
 * render, one at a time, to the same HTML as the whole document: segments
 * end between top-level blocks, which markdown-it renders independently, and
 * share the document's link reference definitions. A single block too large
 * to lay out as one element becomes a plain-text segment. The first and last
 * segments hold only the blocks before the first, and from the last, place a
 * segment may start.
 */
export const segmentMarkdown = async (
  markdown: string,
  renderer: "full" | "fragment",
  { size, hugeBlock }: SegmentOptions
): Promise<SegmentedMarkdown> => {
  const source = markdown.replace(kNewlines, "\n");
  const prepared = prepareFullPipelineMarkdown(source);
  const md = await getMarkdownInstance(renderer, hasMathContent(markdown));
  const env: Env = {};
  const tokens: Token[] = [];
  md.block.parse(prepared, md, env, tokens);

  const sourceLines = lineStarts(source);
  const preparedLines = lineStarts(prepared);
  const segments: MarkdownSegment[] = [];
  const end = sourceLines.length;
  const at = (lines: number[], line: number, text: string) =>
    line < lines.length ? (lines[line] ?? text.length) : text.length;
  let startLine = 0;
  const cut = (endLine: number, plain?: MarkdownSegment["plain"]) => {
    segments.push({
      source: source.slice(
        at(sourceLines, startLine, source),
        at(sourceLines, endLine, source)
      ),
      prepared: prepared.slice(
        at(preparedLines, startLine, prepared),
        at(preparedLines, endLine, prepared)
      ),
      lines: endLine - startLine,
      plain,
    });
    startLine = endLine;
  };
  const sourceOf = (from: number, to: number) =>
    source.slice(at(sourceLines, from, source), at(sourceLines, to, source));

  const blocks = tokens.filter(
    (token): token is Token & { map: [number, number] } =>
      token.level === 0 && token.nesting !== -1 && token.map !== null
  );
  // The first and last segments end and start at the first and last
  // possible boundaries: they aren't chunks (their edge margins collapse
  // through them), so the browser always lays them out, and they stay small.
  const lastStart = blocks.findLast(
    (token) => token.map[0] > 0 && kSegmentStarts.has(token.type)
  )?.map[0];

  for (const token of blocks) {
    const [blockStart, blockEnd] = token.map;
    if (sourceOf(blockStart, blockEnd).length > hugeBlock) {
      if (blockStart > startLine) {
        cut(blockStart);
      }
      cut(blockEnd, plainBlock(token, sourceOf, blockStart, blockEnd));
      continue;
    }
    if (
      blockStart > startLine &&
      kSegmentStarts.has(token.type) &&
      (segments.length === 0 ||
        blockStart === lastStart ||
        sourceOf(startLine, blockStart).length >= size)
    ) {
      cut(blockStart);
    }
  }
  if (sourceOf(startLine, end).length > 0 || segments.length === 0) {
    cut(end);
  }

  return {
    segments,
    render: (segment) => {
      let html = segment.prepared;
      try {
        const tokens = md.parse(segment.prepared, env);
        for (const token of tokens) {
          if (token.level === 0 && token.nesting !== -1 && token.map) {
            token.attrSet(kSourceLinesAttribute, token.map.join(" "));
          }
        }
        html = md.renderer.render(tokens, md.options, env);
      } catch (ex) {
        console.log("Unable to markdown render content");
        console.error(ex);
      }
      return finishFullPipelineHtml(html);
    },
  };
};

// A huge block as plain text: a fenced code block's content, or otherwise
// the block's source.
const plainBlock = (
  token: Token,
  sourceOf: (from: number, to: number) => string,
  blockStart: number,
  blockEnd: number
): MarkdownSegment["plain"] => {
  if (token.type !== "fence") {
    return { text: sourceOf(blockStart, blockEnd), code: false };
  }
  const closed =
    blockEnd - blockStart > 1 &&
    isClosingFence(sourceOf(blockEnd - 1, blockEnd), token.markup);
  return {
    text: sourceOf(blockStart + 1, closed ? blockEnd - 1 : blockEnd),
    code: true,
  };
};

// markdown-it's closing fence: up to three spaces of indent, then at least
// as many of the opening fence's character, then only whitespace.
const isClosingFence = (line: string, markup: string): boolean => {
  const fence = /^ {0,3}(`+|~+)[ \t]*\n?$/.exec(line)?.[1];
  return (
    fence !== undefined &&
    fence[0] === markup[0] &&
    fence.length >= markup.length
  );
};

// Offsets at which each line starts.
const lineStarts = (text: string): number[] => {
  const starts = [0];
  let index = text.indexOf("\n");
  while (index !== -1) {
    starts.push(index + 1);
    index = text.indexOf("\n", index + 1);
  }
  return starts;
};

const renderTextOnlyMarkdown = async (markdown: string): Promise<string> => {
  try {
    return (await getMarkdownInstance("textOnly")).render(markdown);
  } catch (ex) {
    console.log("Unable to markdown render content");
    console.error(ex);
    return escapeHtmlCharacters(markdown).replace(/\n/g, "<br/>");
  }
};

const markdownRenderers: Record<MarkdownRenderer, MarkdownRenderFunction> = {
  full: (markdown) => renderFullPipelineMarkdown(markdown, "full"),
  fragment: (markdown) => renderFullPipelineMarkdown(markdown, "fragment"),
  textOnly: renderTextOnlyMarkdown,
};

export const renderMarkdown = (
  markdown: string,
  renderer: MarkdownRenderer = defaultMarkdownRenderer
): Promise<string> => markdownRenderers[renderer](markdown);
